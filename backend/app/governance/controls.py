"""Manual intervention: pause/resume/cancel projects, retry/reassign/cancel tasks."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.governance.approvals import cancel_pending_for_project
from app.models import TERMINAL_TASK_STATUSES, Agent, Project, ProjectStatus, Task, TaskStatus, utcnow
from app.orchestration import registry
from app.orchestration.state_machine import transition


class ControlError(Exception):
    pass


def pause_project(db: Session, project: Project, user_id) -> None:
    if project.status not in (ProjectStatus.SUBMITTED, ProjectStatus.IN_PROGRESS):
        raise ControlError(f"cannot pause a project that is {project.status}")
    project.status = ProjectStatus.PAUSED
    audit.record(
        db,
        action="project.paused",
        entity_type="project",
        entity_id=project.id,
        actor_type="user",
        actor_id=user_id,
        project_id=project.id,
        client_id=project.client_id,
        message=f"Paused: {project.title}",
    )


def resume_project(db: Session, project: Project, user_id) -> None:
    if project.status != ProjectStatus.PAUSED:
        raise ControlError(f"cannot resume a project that is {project.status}")
    project.status = ProjectStatus.IN_PROGRESS
    audit.record(
        db,
        action="project.resumed",
        entity_type="project",
        entity_id=project.id,
        actor_type="user",
        actor_id=user_id,
        project_id=project.id,
        client_id=project.client_id,
        message=f"Resumed: {project.title}",
    )


def cancel_project(db: Session, project: Project, user_id, reason: str = "") -> None:
    if project.status in (ProjectStatus.COMPLETED, ProjectStatus.CANCELLED):
        raise ControlError(f"project is already {project.status}")
    project.status = ProjectStatus.CANCELLED
    project.completed_at = utcnow()
    for task in db.scalars(
        select(Task).where(Task.project_id == project.id, Task.status.not_in(list(TERMINAL_TASK_STATUSES)))
    ):
        transition(db, task, TaskStatus.CANCELLED, reason="project cancelled", actor_type="user", actor_id=user_id)
    cancel_pending_for_project(db, project, user_id, "project cancelled")
    audit.record(
        db,
        action="project.cancelled",
        entity_type="project",
        entity_id=project.id,
        actor_type="user",
        actor_id=user_id,
        project_id=project.id,
        client_id=project.client_id,
        severity="warning",
        message=f"Cancelled: {project.title}" + (f" ({reason})" if reason else ""),
    )


def retry_task(db: Session, task: Task, user_id) -> None:
    """Give a failed or blocked task another attempt and unblock what waits on it."""
    if task.status not in (TaskStatus.FAILED, TaskStatus.BLOCKED):
        raise ControlError(f"only failed or blocked tasks can be retried (task is {task.status})")
    task.max_attempts = max(task.max_attempts, task.attempt_count + 1)
    if registry.unmet_dependencies(db, task):
        transition(
            db,
            task,
            TaskStatus.PENDING,
            reason="manual retry (waiting on dependencies)",
            actor_type="user",
            actor_id=user_id,
        )
    else:
        transition(db, task, TaskStatus.READY, reason="manual retry", actor_type="user", actor_id=user_id)
    registry.unblock_dependents(db, task)


def reassign_task(db: Session, task: Task, agent: Agent, user_id) -> None:
    if task.status not in (TaskStatus.PENDING, TaskStatus.READY, TaskStatus.BLOCKED, TaskStatus.FAILED):
        raise ControlError(f"cannot reassign a task that is {task.status}")
    if not agent.is_active:
        raise ControlError("cannot assign to an inactive agent")
    if task.kind not in (agent.task_kinds or []):
        raise ControlError(f"{agent.name} cannot perform {task.kind} tasks")
    previous = task.assigned_agent_id
    task.assigned_agent_id = agent.id
    task.department_id = agent.department_id
    audit.record(
        db,
        action="task.reassigned",
        entity_type="task",
        entity_id=task.id,
        actor_type="user",
        actor_id=user_id,
        project_id=task.project_id,
        message=f"{task.title} reassigned to {agent.name}",
        details={"from_agent": str(previous) if previous else None, "to_agent": str(agent.id)},
    )
    if task.status in (TaskStatus.FAILED, TaskStatus.BLOCKED):
        retry_task(db, task, user_id)


def cancel_task(db: Session, task: Task, user_id) -> None:
    if task.status in TERMINAL_TASK_STATUSES:
        raise ControlError(f"task is already {task.status}")
    transition(
        db,
        task,
        TaskStatus.CANCELLED,
        reason="cancelled by user",
        actor_type="user",
        actor_id=user_id,
        severity="warning",
    )
    registry.block_dependents(db, task, reason=f"dependency cancelled: {task.title}")
