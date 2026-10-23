"""Centralized task registry.

All task creation, dependency tracking and claiming goes through here, so coordinators can
see every assignment and no task is ever executed by two workers at once:

* creation is idempotent (unique `idempotency_key`), so a retried orchestration step never
  creates duplicate tasks;
* claiming uses `SELECT ... FOR UPDATE SKIP LOCKED`, so concurrent workers never claim the
  same task;
* a claimed task carries a lease; if its worker dies, the lease expires and the task is
  retried (or failed when attempts are exhausted).
"""

import uuid
from datetime import timedelta

from sqlalchemy import and_, exists, select
from sqlalchemy.orm import Session, aliased

from app import audit
from app.models import (
    Agent,
    AgentMessage,
    Execution,
    ExecutionStatus,
    Project,
    ProjectStatus,
    Task,
    TaskDependency,
    TaskKind,
    TaskStatus,
    utcnow,
)
from app.orchestration.state_machine import transition

ACTIVE_PROJECT_STATUSES = (ProjectStatus.SUBMITTED, ProjectStatus.IN_PROGRESS)


class DependencyCycle(Exception):
    pass


class DependencyError(Exception):
    pass


def create_task(
    db: Session,
    *,
    project: Project,
    kind: TaskKind,
    title: str,
    objective: str,
    idempotency_key: str,
    agent: Agent | None = None,
    created_by: Agent | None = None,
    parent: Task | None = None,
    target: Task | None = None,
    depends_on: list[Task] | None = None,
    input_data: dict | None = None,
    acceptance_criteria: list | None = None,
    requires_review: bool = False,
    requires_approval: bool = False,
    approval_kind: str | None = None,
    priority: int | None = None,
    max_attempts: int | None = None,
    deadline=None,
) -> Task:
    existing = db.scalar(select(Task).where(Task.idempotency_key == idempotency_key))
    if existing is not None:
        return existing

    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        parent_task_id=parent.id if parent else None,
        target_task_id=target.id if target else None,
        kind=kind,
        title=title[:300],
        objective=objective,
        department_id=agent.department_id if agent else None,
        assigned_agent_id=agent.id if agent else None,
        created_by_agent_id=created_by.id if created_by else None,
        status=TaskStatus.PENDING,
        priority=priority if priority is not None else project.priority,
        input_data=input_data or {},
        acceptance_criteria=acceptance_criteria or [],
        requires_review=requires_review,
        requires_approval=requires_approval,
        approval_kind=approval_kind,
        max_attempts=max_attempts if max_attempts is not None else ((agent.max_retries + 1) if agent else 3),
        depth=(parent.depth + 1) if parent else 0,
        deadline=deadline or project.deadline,
        idempotency_key=idempotency_key,
    )
    db.add(task)
    db.flush()
    for dep in depends_on or []:
        add_dependency(db, task, dep)

    db.add(
        AgentMessage(
            project_id=project.id,
            task_id=task.id,
            sender_agent_id=created_by.id if created_by else None,
            recipient_agent_id=agent.id if agent else None,
            message_type="assignment",
            objective=objective[:2000],
            payload={
                "kind": kind,
                "title": task.title,
                "acceptance_criteria": task.acceptance_criteria,
                "depends_on": [str(d.id) for d in depends_on or []],
                "priority": task.priority,
                "deadline": task.deadline.isoformat() if task.deadline else None,
                "requires_review": requires_review,
            },
        )
    )
    audit.record(
        db,
        action="task.created",
        entity_type="task",
        entity_id=task.id,
        actor_type="agent" if created_by else "system",
        actor_id=created_by.id if created_by else None,
        project_id=project.id,
        message=f"Task created: {task.title}" + (f" -> {agent.name}" if agent else ""),
        details={"kind": kind, "agent": agent.key if agent else None},
    )
    refresh_readiness(db, task)
    return task


def add_dependency(db: Session, task: Task, depends_on: Task) -> None:
    """Make `task` wait for `depends_on`. Only allowed before `task` can start."""
    if task.id == depends_on.id:
        raise DependencyCycle("a task cannot depend on itself")
    if task.project_id != depends_on.project_id:
        raise DependencyError("dependencies must be within the same project")
    if task.status not in (TaskStatus.PENDING, TaskStatus.READY):
        raise DependencyError(f"cannot add a dependency to a task in status {task.status}")
    if db.get(TaskDependency, (task.id, depends_on.id)) is not None:
        return
    if _reaches(db, start=depends_on.id, target=task.id):
        raise DependencyCycle(f"dependency {task.title!r} -> {depends_on.title!r} would create a cycle")
    db.add(TaskDependency(task_id=task.id, depends_on_id=depends_on.id))
    db.flush()
    if task.status == TaskStatus.READY and depends_on.status != TaskStatus.APPROVED:
        # Not started yet, so it simply goes back to waiting.
        transition(db, task, TaskStatus.PENDING, reason=f"new dependency: {depends_on.title}")


def _reaches(db: Session, *, start: uuid.UUID, target: uuid.UUID) -> bool:
    """True if `target` is reachable from `start` by following depends_on edges."""
    seen: set[uuid.UUID] = set()
    frontier = [start]
    while frontier:
        current = frontier.pop()
        if current == target:
            return True
        if current in seen:
            continue
        seen.add(current)
        frontier.extend(db.scalars(select(TaskDependency.depends_on_id).where(TaskDependency.task_id == current)))
    return False


def unmet_dependencies(db: Session, task: Task) -> list[Task]:
    dep = aliased(Task)
    return list(
        db.scalars(
            select(dep)
            .join(TaskDependency, TaskDependency.depends_on_id == dep.id)
            .where(TaskDependency.task_id == task.id, dep.status != TaskStatus.APPROVED)
        )
    )


def refresh_readiness(db: Session, task: Task) -> bool:
    """Move a PENDING task to READY when all its dependencies are approved."""
    if task.status != TaskStatus.PENDING:
        return False
    if unmet_dependencies(db, task):
        return False
    transition(db, task, TaskStatus.READY, reason="dependencies satisfied")
    return True


def dependents(db: Session, task: Task) -> list[Task]:
    return list(
        db.scalars(
            select(Task)
            .join(TaskDependency, TaskDependency.task_id == Task.id)
            .where(TaskDependency.depends_on_id == task.id)
        )
    )


def on_task_approved(db: Session, task: Task) -> list[Task]:
    """Promote dependents whose dependencies are now all approved."""
    promoted = []
    for dependent in dependents(db, task):
        if refresh_readiness(db, dependent):
            promoted.append(dependent)
    return promoted


def block_dependents(db: Session, task: Task, reason: str) -> None:
    """A task failed or was cancelled: everything waiting on it is blocked (transitively)."""
    frontier = dependents(db, task)
    while frontier:
        current = frontier.pop()
        if current.status in (TaskStatus.PENDING, TaskStatus.READY):
            transition(db, current, TaskStatus.BLOCKED, reason=reason, severity="warning")
            frontier.extend(dependents(db, current))


def unblock_dependents(db: Session, task: Task) -> None:
    """Undo `block_dependents` after a manual retry of `task`."""
    frontier = dependents(db, task)
    while frontier:
        current = frontier.pop()
        if current.status == TaskStatus.BLOCKED:
            transition(db, current, TaskStatus.PENDING, reason="upstream task retried")
            frontier.extend(dependents(db, current))


def claim_next(db: Session, worker_id: str, lease_seconds: int, kinds: list[str] | None = None) -> Task | None:
    """Atomically claim the highest-priority READY task of an active project."""
    stmt = (
        select(Task)
        .join(Project, Project.id == Task.project_id)
        .where(Task.status == TaskStatus.READY, Project.status.in_(ACTIVE_PROJECT_STATUSES))
        .order_by(Task.priority, Task.created_at)
        .limit(1)
        .with_for_update(of=Task, skip_locked=True)
    )
    if kinds:
        stmt = stmt.where(Task.kind.in_(kinds))
    task = db.scalar(stmt)
    if task is None:
        return None
    task.attempt_count += 1
    transition(db, task, TaskStatus.RUNNING, reason=f"claimed by {worker_id}", details={"attempt": task.attempt_count})
    task.lease_owner = worker_id
    task.lease_expires_at = utcnow() + timedelta(seconds=lease_seconds)
    db.flush()
    return task


def extend_lease(db: Session, task_id: uuid.UUID, worker_id: str, lease_seconds: int) -> bool:
    task = db.get(Task, task_id, with_for_update=True)
    if task is None or task.status != TaskStatus.RUNNING or task.lease_owner != worker_id:
        return False
    task.lease_expires_at = utcnow() + timedelta(seconds=lease_seconds)
    return True


def reap_expired_leases(db: Session) -> int:
    """Recover tasks whose worker crashed or hung past its lease."""
    expired = list(
        db.scalars(
            select(Task)
            .where(Task.status == TaskStatus.RUNNING, Task.lease_expires_at < utcnow())
            .with_for_update(skip_locked=True)
        )
    )
    for task in expired:
        for execution in db.scalars(
            select(Execution).where(Execution.task_id == task.id, Execution.status == ExecutionStatus.RUNNING)
        ):
            execution.status = ExecutionStatus.FAILED
            execution.error = "lease expired (worker lost or timed out)"
            execution.finished_at = utcnow()
        fail_or_retry(db, task, "lease expired (worker lost or timed out)")
    return len(expired)


def fail_or_retry(db: Session, task: Task, error: str) -> None:
    """Recoverable failure: retry while attempts remain, otherwise fail and block dependents."""
    task.last_error = error[:4000]
    if task.attempt_count < task.max_attempts:
        transition(
            db,
            task,
            TaskStatus.READY,
            reason=f"retry {task.attempt_count + 1}/{task.max_attempts}: {error[:200]}",
            severity="warning",
        )
    else:
        transition(db, task, TaskStatus.FAILED, reason=error[:300], severity="error")
        block_dependents(db, task, reason=f"dependency failed: {task.title}")


def has_open_tasks(db: Session, project_id: uuid.UUID) -> bool:
    return bool(
        db.scalar(
            select(
                exists().where(
                    and_(
                        Task.project_id == project_id,
                        Task.status.not_in([TaskStatus.APPROVED, TaskStatus.FAILED, TaskStatus.CANCELLED]),
                    )
                )
            )
        )
    )
