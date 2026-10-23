"""Workflow engine: what happens when a task is executed and when its output is accepted.

End-to-end flow (each arrow is a task in the registry):

    client project -> ANALYZE (CEO) -> PLAN (Task Planning Agent)
        -> per work package: ALLOCATE (department head) -> EXECUTE (specialists, may be nested
           through sub-coordinators) -> REVIEW (QA, retry on rejection) -> CONSOLIDATE (department head)
        -> FINAL_REPORT (CEO) -> human FINAL_DELIVERY approval -> client

A task's output is acted on only after it passes schema validation and task-specific checks;
specialist work additionally has to pass an independent QA review.
"""

import logging
import mimetypes
import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.agents.runner import Aborted, AgentConfig, AgentRunner, RunOutcome, SemanticCheck
from app.config import Settings
from app.db import session_scope
from app.governance.approvals import request_approval
from app.models import (
    Agent,
    AgentRole,
    ApprovalKind,
    Artifact,
    ArtifactKind,
    Client,
    Department,
    Execution,
    ExecutionStatus,
    Project,
    ProjectStatus,
    Review,
    Task,
    TaskKind,
    TaskStatus,
    utcnow,
)
from app.orchestration import registry
from app.orchestration.protocol import (
    assignable_team,
    build_envelope,
    dependency_tasks,
    record_message,
    reviewers,
    task_output_for_context,
)
from app.orchestration.registry import ACTIVE_PROJECT_STATUSES
from app.orchestration.state_machine import transition
from app.storage import get_storage, save_artifact

log = logging.getLogger(__name__)

COORDINATING_ROLES = (AgentRole.DIRECTOR, AgentRole.COORDINATOR, AgentRole.SUB_COORDINATOR)


class EngineError(Exception):
    pass


# --------------------------------------------------------------------------- agent lookup


def agent_for_kind(db: Session, kind: TaskKind, prefer_key: str | None = None) -> Agent:
    agents = [
        a for a in db.scalars(select(Agent).where(Agent.is_active).order_by(Agent.key)) if kind in (a.task_kinds or [])
    ]
    if not agents:
        raise EngineError(f"no active agent can perform {kind} tasks")
    preferred = [a for a in agents if a.key == prefer_key]
    return preferred[0] if preferred else agents[0]


def department_head(db: Session, department_key: str) -> Agent | None:
    ceo = db.scalar(select(Agent).where(Agent.role_type == AgentRole.CEO))
    return db.scalar(
        select(Agent)
        .join(Department, Department.id == Agent.department_id)
        .where(
            Department.key == department_key,
            Agent.is_active,
            Agent.role_type.in_([AgentRole.DIRECTOR, AgentRole.COORDINATOR]),
            Agent.reports_to_id == (ceo.id if ceo else None),
        )
    )


def choose_reviewer(db: Session, task: Task, author: Agent) -> Agent:
    candidates = [a for a in reviewers(db) if a.id != author.id]
    if not candidates:
        raise EngineError("no active QA reviewer is available")
    requested = task.input_data.get("reviewer_key")
    for key in (requested, "output_review"):
        for candidate in candidates:
            if candidate.key == key:
                return candidate
    return candidates[0]


# --------------------------------------------------------------------------- submission


def submit_project(db: Session, project: Project, actor_user_id=None) -> Task:
    if project.status != ProjectStatus.SUBMITTED:
        raise EngineError(f"project is {project.status}, not submitted")
    ceo = agent_for_kind(db, TaskKind.ANALYZE, prefer_key="ceo")
    project.status = ProjectStatus.IN_PROGRESS
    project.started_at = utcnow()
    task = registry.create_task(
        db,
        project=project,
        kind=TaskKind.ANALYZE,
        title="Analyze client request",
        objective=(
            "Understand the client's request and define the project objective, measurable expected outcomes "
            "and the departments required."
        ),
        idempotency_key=f"{project.id}:analyze",
        agent=ceo,
    )
    audit.record(
        db,
        action="project.started",
        entity_type="project",
        entity_id=project.id,
        actor_type="user" if actor_user_id else "system",
        actor_id=actor_user_id,
        project_id=project.id,
        client_id=project.client_id,
        message=f"Project started: {project.title}",
    )
    return task


# --------------------------------------------------------------------------- validation


def _refs_errors(items: list[dict], label: str, limit: int) -> list[str]:
    errors = []
    refs = [i["ref"] for i in items]
    if len(items) > limit:
        errors.append(f"too many {label} ({len(items)} > {limit})")
    if len(refs) != len(set(refs)):
        errors.append(f"{label} refs must be unique")
    known = set(refs)
    for item in items:
        for dep in item.get("depends_on", []):
            if dep not in known:
                errors.append(f"{item['ref']}: depends_on unknown ref {dep!r}")
            if dep == item["ref"]:
                errors.append(f"{item['ref']}: cannot depend on itself")
    if not errors and topological_order(items) is None:
        errors.append(f"{label} dependencies contain a cycle")
    return errors


def topological_order(items: list[dict]) -> list[dict] | None:
    by_ref = {i["ref"]: i for i in items}
    order, state = [], {}

    def visit(ref: str) -> bool:
        if state.get(ref) == "done":
            return True
        if state.get(ref) == "visiting":
            return False
        state[ref] = "visiting"
        for dep in by_ref[ref].get("depends_on", []):
            if dep in by_ref and not visit(dep):
                return False
        state[ref] = "done"
        order.append(by_ref[ref])
        return True

    for item in items:
        if not visit(item["ref"]):
            return None
    return order


def build_semantic_check(db: Session, task: Task, settings: Settings) -> SemanticCheck:
    kind = TaskKind(task.kind)
    limit = settings.max_plan_tasks

    if kind == TaskKind.ANALYZE:
        dept_keys = {d.key for d in db.scalars(select(Department))}

        def check(output: dict, tools: list[dict]) -> list[str]:
            unknown = sorted(set(output["departments"]) - dept_keys)
            return [f"unknown departments: {unknown}; use keys from context.available_departments"] if unknown else []

        return check

    if kind == TaskKind.PLAN:
        staffed = {d.key for d in db.scalars(select(Department)) if d.key != "executive" and department_head(db, d.key)}

        def check(output: dict, tools: list[dict]) -> list[str]:
            packages = output["work_packages"]
            errors = _refs_errors(packages, "work_packages", limit)
            for p in packages:
                if p["department"] not in staffed:
                    errors.append(f"{p['ref']}: department {p['department']!r} is not available")
            return errors

        return check

    if kind == TaskKind.ALLOCATE:
        coordinator = db.get(Agent, task.assigned_agent_id)
        team = {a.key: a.role_type for a in assignable_team(db, coordinator)} if coordinator else {}
        reviewer_keys = {a.key for a in reviewers(db)}
        level = int(task.input_data.get("delegation_level", 1))

        def check(output: dict, tools: list[dict]) -> list[str]:
            assignments = output["assignments"]
            errors = _refs_errors(assignments, "assignments", limit)
            for a in assignments:
                role = team.get(a["agent_key"])
                if role is None:
                    errors.append(f"{a['ref']}: {a['agent_key']!r} is not in your team (context.team)")
                elif role in COORDINATING_ROLES and level >= settings.max_delegation_depth:
                    errors.append(f"{a['ref']}: delegation depth limit reached; assign to specialists directly")
                if a.get("reviewer_key") and a["reviewer_key"] not in reviewer_keys:
                    errors.append(f"{a['ref']}: reviewer_key must be one of {sorted(reviewer_keys)}")
            return errors

        return check

    if kind == TaskKind.EXECUTE:
        criteria_count = len(task.acceptance_criteria or [])

        def check(output: dict, tools: list[dict]) -> list[str]:
            errors = []
            call_ids = {t["tool_call_id"] for t in tools}
            for e in output["evidence"]:
                if e.get("tool_call_id") and e["tool_call_id"] not in call_ids:
                    errors.append(f"evidence cites tool_call_id {e['tool_call_id']!r}, which was never made")
                if e["type"] == "tool_result" and not e.get("tool_call_id"):
                    errors.append("evidence of type tool_result must cite a tool_call_id")
            if len(output["self_assessment"]) < criteria_count:
                errors.append(f"self_assessment must cover all {criteria_count} acceptance criteria")
            names = [d["name"] for d in output["deliverables"]]
            if len(names) != len(set(names)):
                errors.append("deliverable names must be unique")
            return errors

        return check

    if kind == TaskKind.REVIEW:

        def check(output: dict, tools: list[dict]) -> list[str]:
            if output["verdict"] == "approved" and not all(c["met"] for c in output["criteria_results"]):
                return ["verdict 'approved' is inconsistent with unmet criteria"]
            if output["verdict"] == "rejected" and not (output["feedback"].strip() or output.get("required_fixes")):
                return ["a rejection must explain what to fix"]
            if not output["criteria_results"]:
                return ["criteria_results must assess each acceptance criterion"]
            return []

        return check

    return lambda output, tools: []


# --------------------------------------------------------------------------- execution


def process_task(task_id: uuid.UUID, worker_id: str, runner: AgentRunner, settings: Settings) -> str:
    """Run a claimed task end to end. Returns a short status for the worker loop."""
    # Phase 1: prepare (short transaction).
    with session_scope() as db:
        task = db.get(Task, task_id, with_for_update=True)
        if task is None or task.status != TaskStatus.RUNNING or task.lease_owner != worker_id:
            return "skipped"
        project = db.get(Project, task.project_id)
        agent = db.get(Agent, task.assigned_agent_id) if task.assigned_agent_id else None
        if agent is None or not agent.is_active:
            task.attempt_count -= 1
            transition(db, task, TaskStatus.BLOCKED, reason="assigned agent is missing or inactive", severity="error")
            return "blocked"
        if task.requires_approval and not task.approval_granted:
            request_approval(
                db,
                project_id=task.project_id,
                task=task,
                kind=task.approval_kind or ApprovalKind.EXTERNAL_ACTION,
                title=f"Approve before execution: {task.title}",
                details={"objective": task.objective, "reason": task.input_data.get("approval_reason")},
                requested_by=agent,
            )
            task.attempt_count -= 1
            transition(db, task, TaskStatus.AWAITING_APPROVAL, reason="human approval required before execution")
            return "awaiting_approval"
        execution = Execution(
            task_id=task.id,
            agent_id=agent.id,
            project_id=task.project_id,
            attempt=task.attempt_count,
            worker_id=worker_id,
        )
        db.add(execution)
        db.flush()
        execution_id = execution.id
        envelope = build_envelope(db, task)
        check = build_semantic_check(db, task, settings)
        department = db.get(Department, agent.department_id) if agent.department_id else None
        config = AgentConfig.from_agent(agent, department.name if department else "")
        client = db.get(Client, project.client_id)
        allow_external = bool(client and client.allow_external_llm)
        budget_multiplier = 1 + int(task.input_data.get("budget_extensions", 0))
        kind, project_id = task.kind, task.project_id
        audit.record(
            db,
            action="execution.started",
            entity_type="execution",
            entity_id=execution_id,
            actor_type="agent",
            actor_id=agent.id,
            project_id=project_id,
            message=f"{agent.name} started {task.title} (attempt {task.attempt_count}/{task.max_attempts})",
        )

    # Phase 2: run the agent (no transaction held open during LLM calls).
    def heartbeat() -> None:
        with session_scope() as hb:
            if not registry.extend_lease(hb, task_id, worker_id, settings.task_lease_seconds):
                raise Aborted("lease lost: the task was cancelled, reassigned or timed out")
            status = hb.scalar(select(Project.status).where(Project.id == project_id))
            if status not in ACTIVE_PROJECT_STATUSES:
                raise Aborted(f"project is {status}")

    started = utcnow()
    try:
        outcome = runner.run(
            agent=config,
            kind=kind,
            envelope=envelope,
            task_id=task_id,
            project_id=project_id,
            execution_id=execution_id,
            allow_external=allow_external,
            semantic_check=check,
            heartbeat=heartbeat,
            budget_multiplier=budget_multiplier,
        )
    except Aborted as exc:
        outcome = RunOutcome("aborted", error=str(exc))
    except Exception as exc:  # never let one task crash the worker
        log.exception("agent run crashed")
        outcome = RunOutcome("failed", error=f"internal error: {type(exc).__name__}: {exc}")

    # Phase 3: apply the outcome (short transaction), only if we still own the task.
    with session_scope() as db:
        task = db.get(Task, task_id, with_for_update=True)
        execution = db.get(Execution, execution_id)
        execution.finished_at = utcnow()
        execution.latency_ms = int((execution.finished_at - started).total_seconds() * 1000)
        execution.output = outcome.output
        execution.error = outcome.error
        if task.status != TaskStatus.RUNNING or task.lease_owner != worker_id:
            execution.status = ExecutionStatus.FAILED
            execution.error = (outcome.error or "") + " [result discarded: task no longer owned by this worker]"
            return "discarded"
        try:
            return apply_outcome(db, task, execution, outcome)
        except EngineError as exc:
            execution.status = ExecutionStatus.FAILED
            execution.error = str(exc)
            transition(db, task, TaskStatus.BLOCKED, reason=str(exc), severity="error")
            return "blocked"


def apply_outcome(db: Session, task: Task, execution: Execution, outcome: RunOutcome) -> str:
    agent = db.get(Agent, task.assigned_agent_id)
    if outcome.status == "completed":
        execution.status = ExecutionStatus.SUCCEEDED
        COMPLETE_HANDLERS[TaskKind(task.kind)](db, task, outcome.output, outcome.tool_records)
        return "completed"

    if outcome.status == "clarification":
        execution.status = ExecutionStatus.SUCCEEDED
        request_approval(
            db,
            project_id=task.project_id,
            task=task,
            kind=ApprovalKind.CLARIFICATION,
            title=f"Clarification needed: {task.title}",
            details={"questions": outcome.questions},
            requested_by=agent,
        )
        task.attempt_count -= 1
        transition(db, task, TaskStatus.AWAITING_APPROVAL, reason="agent requested clarification")
        return "clarification"

    if outcome.status == "budget_exceeded":
        execution.status = ExecutionStatus.FAILED
        request_approval(
            db,
            project_id=task.project_id,
            task=task,
            kind=ApprovalKind.BUDGET_OVERRUN,
            title=f"Budget exceeded: {task.title}",
            details=outcome.budget_details,
            requested_by=agent,
        )
        task.attempt_count -= 1
        transition(
            db, task, TaskStatus.AWAITING_APPROVAL, reason=outcome.error or "budget exceeded", severity="warning"
        )
        return "budget_exceeded"

    execution.status = ExecutionStatus.FAILED
    if outcome.status == "aborted":
        # Not the agent's fault (LLM unavailable, project paused): give the attempt back.
        task.attempt_count -= 1
        transition(db, task, TaskStatus.READY, reason=outcome.error or "aborted", severity="warning")
        return "llm_unavailable" if (outcome.error or "").startswith("LLM unavailable") else "aborted"

    registry.fail_or_retry(db, task, outcome.error or "failed")
    return "failed"


# --------------------------------------------------------------------------- completion handlers


def _approve(db: Session, task: Task) -> None:
    transition(db, task, TaskStatus.APPROVED, reason="output verified")
    registry.on_task_approved(db, task)
    agent = db.get(Agent, task.assigned_agent_id) if task.assigned_agent_id else None
    creator = db.get(Agent, task.created_by_agent_id) if task.created_by_agent_id else None
    record_message(
        db,
        task=task,
        message_type="result",
        sender=agent,
        recipient=creator,
        objective=task.objective,
        payload={"status": TaskStatus.APPROVED, "summary": (task.result or {}).get("summary")},
    )


def _complete_analyze(db: Session, task: Task, output: dict, tools: list[dict]) -> None:
    project = db.get(Project, task.project_id)
    ceo = db.get(Agent, task.assigned_agent_id)
    task.result = output
    project.objective = output["objective"]
    project.expected_outcomes = output["expected_outcomes"]
    planner = agent_for_kind(db, TaskKind.PLAN, prefer_key="task_planning")
    plan = registry.create_task(
        db,
        project=project,
        kind=TaskKind.PLAN,
        title="Plan work packages",
        objective="Break the project objective into department work packages with dependencies and acceptance "
        "criteria.",
        idempotency_key=f"{project.id}:plan",
        agent=planner,
        created_by=ceo,
        parent=task,
        depends_on=[task],
        input_data={"departments": output["departments"]},
    )
    registry.create_task(
        db,
        project=project,
        kind=TaskKind.FINAL_REPORT,
        title="Final executive report",
        objective="Review the department reports, verify the evidence and prepare the final deliverable for the "
        "client.",
        idempotency_key=f"{project.id}:final:1",
        agent=ceo,
        created_by=ceo,
        parent=task,
        depends_on=[plan],
        input_data={"round": 1},
    )
    _approve(db, task)


def _complete_plan(db: Session, task: Task, output: dict, tools: list[dict]) -> None:
    project = db.get(Project, task.project_id)
    planner = db.get(Agent, task.assigned_agent_id)
    task.result = output
    final = db.scalar(
        select(Task)
        .where(Task.project_id == project.id, Task.kind == TaskKind.FINAL_REPORT, Task.status == TaskStatus.PENDING)
        .order_by(Task.created_at.desc())
    )
    closing: dict[str, Task] = {}
    for package in topological_order(output["work_packages"]):
        head = department_head(db, package["department"])
        if head is None:
            raise EngineError(f"department {package['department']} has no active head")
        dept = db.get(Department, head.department_id)
        allocate = registry.create_task(
            db,
            project=project,
            kind=TaskKind.ALLOCATE,
            title=f"{dept.name}: {package['title']}",
            objective=package["objective"],
            acceptance_criteria=package["acceptance_criteria"],
            idempotency_key=f"{task.id}:alloc:{package['ref']}",
            agent=head,
            created_by=planner,
            parent=task,
            depends_on=[closing[ref] for ref in package.get("depends_on", [])],
            input_data={"work_package": package, "delegation_level": 1},
        )
        closing[package["ref"]] = registry.create_task(
            db,
            project=project,
            kind=TaskKind.CONSOLIDATE,
            title=f"{dept.name} report: {package['title']}",
            objective="Consolidate the approved results of this work package into a department report for the CEO.",
            acceptance_criteria=package["acceptance_criteria"],
            idempotency_key=f"{task.id}:cons:{package['ref']}",
            agent=head,
            created_by=planner,
            parent=task,
            target=allocate,
            depends_on=[allocate],
        )
    if final is not None:
        for consolidate in closing.values():
            registry.add_dependency(db, final, consolidate)
    _approve(db, task)


def _complete_allocate(db: Session, task: Task, output: dict, tools: list[dict]) -> None:
    project = db.get(Project, task.project_id)
    coordinator = db.get(Agent, task.assigned_agent_id)
    task.result = output
    consolidate = db.scalar(select(Task).where(Task.target_task_id == task.id, Task.kind == TaskKind.CONSOLIDATE))
    if consolidate is None:
        raise EngineError("allocation has no consolidation task")
    package = task.input_data.get("work_package") or {}
    level = int(task.input_data.get("delegation_level", 1))
    upstream = [
        task_output_for_context(db, dep, include_content=False)
        for dep in dependency_tasks(db, task)
        if dep.status == TaskStatus.APPROVED
    ]
    agents = {a.key: a for a in assignable_team(db, coordinator)}
    ends: dict[str, Task] = {}
    for a in topological_order(output["assignments"]):
        member = agents.get(a["agent_key"])
        if member is None:
            raise EngineError(f"{a['agent_key']} is no longer available")
        depends_on = [ends[ref] for ref in a.get("depends_on", [])]
        key = f"{task.id}:{a['ref']}"
        if member.role_type in COORDINATING_ROLES:
            sub_allocate = registry.create_task(
                db,
                project=project,
                kind=TaskKind.ALLOCATE,
                title=a["title"],
                objective=a["objective"],
                acceptance_criteria=a["acceptance_criteria"],
                idempotency_key=f"{key}:alloc",
                agent=member,
                created_by=coordinator,
                parent=task,
                depends_on=depends_on,
                input_data={
                    "work_package": {
                        "title": a["title"],
                        "objective": a["objective"],
                        "acceptance_criteria": a["acceptance_criteria"],
                        "parent_package": package.get("title"),
                    },
                    "delegation_level": level + 1,
                },
            )
            ends[a["ref"]] = registry.create_task(
                db,
                project=project,
                kind=TaskKind.CONSOLIDATE,
                title=f"Report: {a['title']}",
                objective="Consolidate your team's approved results for this sub-package.",
                acceptance_criteria=a["acceptance_criteria"],
                idempotency_key=f"{key}:cons",
                agent=member,
                created_by=coordinator,
                parent=task,
                target=sub_allocate,
                depends_on=[sub_allocate],
            )
        else:
            flagged = bool(a.get("requires_human_approval"))
            ends[a["ref"]] = registry.create_task(
                db,
                project=project,
                kind=TaskKind.EXECUTE,
                title=a["title"],
                objective=a["objective"],
                acceptance_criteria=a["acceptance_criteria"],
                idempotency_key=key,
                agent=member,
                created_by=coordinator,
                parent=task,
                depends_on=depends_on,
                requires_review=True,
                requires_approval=flagged,
                approval_kind=(a.get("approval_kind") or ApprovalKind.EXTERNAL_ACTION) if flagged else None,
                priority=a.get("priority"),
                input_data={
                    "work_package_title": package.get("title"),
                    "upstream_results": upstream,
                    "reviewer_key": a.get("reviewer_key"),
                    "approval_reason": a.get("approval_reason"),
                },
            )
        registry.add_dependency(db, consolidate, ends[a["ref"]])
    _approve(db, task)


def _summarize_tool_result(result: dict) -> dict:
    if "exit_code" in result:
        return {
            "exit_code": result.get("exit_code"),
            "timed_out": result.get("timed_out"),
            "stdout": str(result.get("stdout", ""))[-3000:],
            "stderr": str(result.get("stderr", ""))[-2000:],
        }
    text = str(result)
    return {"excerpt": text[:3000]}


def _complete_execute(db: Session, task: Task, output: dict, tools: list[dict]) -> None:
    author = db.get(Agent, task.assigned_agent_id)
    # Deliverables of earlier, rejected attempts are superseded (their content stays in executions).
    for old in db.scalars(select(Artifact).where(Artifact.task_id == task.id, Artifact.kind == ArtifactKind.WORK)):
        get_storage().delete(old.storage_key)
        db.delete(old)
    files = []
    for deliverable in output["deliverables"]:
        content_type = deliverable.get("content_type") or mimetypes.guess_type(deliverable["name"])[0] or "text/plain"
        artifact = save_artifact(
            db,
            project_id=task.project_id,
            kind=ArtifactKind.WORK,
            name=deliverable["name"],
            data=deliverable["content"].encode("utf-8"),
            content_type=content_type,
            task_id=task.id,
            agent_id=author.id,
        )
        files.append({"name": artifact.name, "file_id": str(artifact.id), "size": artifact.size_bytes})
    task.result = {**{k: v for k, v in output.items() if k != "deliverables"}, "deliverables": files}
    task.evidence = [
        {
            "verified_by": "platform",
            "tool_call_id": record["tool_call_id"],
            "tool": record["tool"],
            "ok": record["ok"],
            "arguments": record["arguments"],
            "result": _summarize_tool_result(record["full_result"]),
        }
        for record in tools
    ]
    transition(db, task, TaskStatus.IN_REVIEW, reason="submitted for QA review")
    reviewer = choose_reviewer(db, task, author)
    registry.create_task(
        db,
        project=db.get(Project, task.project_id),
        kind=TaskKind.REVIEW,
        title=f"QA review: {task.title} (attempt {task.attempt_count})",
        objective="Independently verify that the work meets every acceptance criterion, based on evidence.",
        acceptance_criteria=task.acceptance_criteria,
        idempotency_key=f"{task.id}:review:{task.attempt_count}",
        agent=reviewer,
        parent=task,
        target=task,
        priority=task.priority,
        input_data={"attempt": task.attempt_count},
    )
    creator = db.get(Agent, task.created_by_agent_id) if task.created_by_agent_id else None
    record_message(
        db,
        task=task,
        message_type="result",
        sender=author,
        recipient=creator,
        objective=task.objective,
        payload={"status": TaskStatus.IN_REVIEW, "summary": output["summary"], "deliverables": files},
    )


def _complete_review(db: Session, task: Task, output: dict, tools: list[dict]) -> None:
    reviewer = db.get(Agent, task.assigned_agent_id)
    target = db.get(Task, task.target_task_id, with_for_update=True)
    task.result = {**output, "summary": f"{output['verdict']}: {output['feedback'][:300]}"}
    db.add(
        Review(
            task_id=target.id,
            review_task_id=task.id,
            reviewer_agent_id=reviewer.id,
            attempt=target.attempt_count,
            verdict=output["verdict"],
            score=output["score"],
            feedback=output["feedback"],
            checks=output["criteria_results"]
            + [
                {
                    "verified_by": "platform",
                    "tool": r["tool"],
                    "ok": r["ok"],
                    "result": _summarize_tool_result(r["full_result"]),
                }
                for r in tools
            ],
        )
    )
    _approve(db, task)
    if target.status != TaskStatus.IN_REVIEW:
        audit.record(
            db,
            action="review.ignored",
            entity_type="task",
            entity_id=target.id,
            project_id=target.project_id,
            message=f"Review of {target.title} ignored: task is {target.status}",
        )
        return

    author = db.get(Agent, target.assigned_agent_id)
    record_message(
        db,
        task=target,
        message_type="review",
        sender=reviewer,
        recipient=author,
        objective=target.objective,
        payload={
            "verdict": output["verdict"],
            "score": output["score"],
            "feedback": output["feedback"],
            "required_fixes": output.get("required_fixes", []),
        },
    )
    if output["verdict"] == "approved":
        transition(db, target, TaskStatus.APPROVED, reason=f"approved by {reviewer.name} (score {output['score']})")
        registry.on_task_approved(db, target)
        for action in (target.result or {}).get("proposed_external_actions", []):
            request_approval(
                db,
                project_id=target.project_id,
                task=target,
                kind=action["kind"],
                title=f"Proposed by {author.name}: {action['description'][:200]}",
                details=action,
                requested_by=author,
            )
    else:
        target.feedback = [
            *target.feedback,
            {
                "attempt": target.attempt_count,
                "reviewer": reviewer.name,
                "feedback": output["feedback"],
                "required_fixes": output.get("required_fixes", []),
            },
        ]
        registry.fail_or_retry(
            db, target, f"rejected by QA (attempt {target.attempt_count}): {output['feedback'][:300]}"
        )


def _complete_consolidate(db: Session, task: Task, output: dict, tools: list[dict]) -> None:
    task.result = output
    _approve(db, task)


def _complete_final_report(db: Session, task: Task, output: dict, tools: list[dict]) -> None:
    project = db.get(Project, task.project_id)
    ceo = db.get(Agent, task.assigned_agent_id)
    task.result = {**output, "summary": output["executive_summary"]}
    project.final_report = output
    for old in db.scalars(
        select(Artifact).where(Artifact.project_id == project.id, Artifact.kind == ArtifactKind.DELIVERABLE)
    ):
        get_storage().delete(old.storage_key)
        db.delete(old)
    save_artifact(
        db,
        project_id=project.id,
        kind=ArtifactKind.DELIVERABLE,
        name="final-report.md",
        data=output["final_deliverable_markdown"].encode("utf-8"),
        content_type="text/markdown",
        task_id=task.id,
        agent_id=ceo.id,
    )
    _approve(db, task)
    project.status = ProjectStatus.AWAITING_APPROVAL
    request_approval(
        db,
        project_id=project.id,
        task=task,
        kind=ApprovalKind.FINAL_DELIVERY,
        title=f"Release final deliverables: {project.title}",
        details={
            "executive_summary": output["executive_summary"],
            "objective_met": output["objective_met"],
            "spent_usd": str(project.spent_usd),
            "tokens_used": project.tokens_used,
        },
        requested_by=ceo,
    )


COMPLETE_HANDLERS: dict[TaskKind, Callable[[Session, Task, dict, list[dict]], None]] = {
    TaskKind.ANALYZE: _complete_analyze,
    TaskKind.PLAN: _complete_plan,
    TaskKind.ALLOCATE: _complete_allocate,
    TaskKind.EXECUTE: _complete_execute,
    TaskKind.REVIEW: _complete_review,
    TaskKind.CONSOLIDATE: _complete_consolidate,
    TaskKind.FINAL_REPORT: _complete_final_report,
}
