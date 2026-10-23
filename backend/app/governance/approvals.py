"""Human approval gates.

Agents never decide sensitive, expensive, irreversible or externally consequential actions.
They create an approval request; a human supervisor (or, for clarifications, the client)
decides, and the decision moves the workflow forward.
"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.models import (
    Agent,
    Approval,
    ApprovalKind,
    ApprovalStatus,
    Project,
    ProjectStatus,
    Task,
    TaskDependency,
    TaskKind,
    TaskStatus,
    utcnow,
)
from app.orchestration import registry
from app.orchestration.state_machine import transition


class ApprovalError(Exception):
    pass


def request_approval(
    db: Session,
    *,
    project_id,
    kind: str,
    title: str,
    details: dict,
    task: Task | None = None,
    requested_by: Agent | None = None,
) -> Approval:
    approval = Approval(
        project_id=project_id,
        task_id=task.id if task else None,
        kind=kind,
        title=title[:300],
        details=details,
        requested_by_agent_id=requested_by.id if requested_by else None,
    )
    db.add(approval)
    db.flush()
    audit.record(
        db,
        action="approval.requested",
        entity_type="approval",
        entity_id=approval.id,
        actor_type="agent" if requested_by else "system",
        actor_id=requested_by.id if requested_by else None,
        project_id=project_id,
        severity="warning",
        message=f"Human decision needed ({kind}): {title}",
        details={"kind": kind},
    )
    return approval


def decide(db: Session, approval: Approval, *, user_id, approve: bool, note: str | None = None) -> Approval:
    if approval.status != ApprovalStatus.PENDING:
        raise ApprovalError(f"approval is already {approval.status}")
    approval.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
    approval.decided_by_id = user_id
    approval.decision_note = note
    approval.decided_at = utcnow()
    task = db.get(Task, approval.task_id, with_for_update=True) if approval.task_id else None
    project = db.get(Project, approval.project_id)
    waiting = task is not None and task.status == TaskStatus.AWAITING_APPROVAL
    actor = {"actor_type": "user", "actor_id": user_id}

    if approval.kind == ApprovalKind.CLARIFICATION:
        answer = (note or "").strip() if approve else ""
        if not answer:
            answer = "No clarification available: proceed with reasonable assumptions and state them explicitly."
        task.input_data = {
            **task.input_data,
            "clarifications": [
                *task.input_data.get("clarifications", []),
                {"questions": approval.details.get("questions", []), "answer": answer},
            ],
        }
        if waiting:
            transition(db, task, TaskStatus.READY, reason="clarification answered", **actor)

    elif approval.kind == ApprovalKind.BUDGET_OVERRUN:
        if approve:
            if approval.details.get("scope") == "project":
                if project.budget_usd is not None:
                    project.budget_usd = max(project.budget_usd, project.spent_usd) * Decimal("1.5")
                if project.budget_tokens is not None:
                    project.budget_tokens = int(max(project.budget_tokens, project.tokens_used) * 1.5)
            else:
                task.input_data = {
                    **task.input_data,
                    "budget_extensions": task.input_data.get("budget_extensions", 0) + 1,
                }
            if waiting:
                transition(db, task, TaskStatus.READY, reason="budget extension approved", **actor)
        elif waiting:
            transition(db, task, TaskStatus.CANCELLED, reason="budget extension rejected", severity="warning", **actor)
            registry.block_dependents(db, task, reason=f"dependency cancelled: {task.title}")

    elif approval.kind == ApprovalKind.FINAL_DELIVERY:
        if approve:
            project.status = ProjectStatus.COMPLETED
            project.completed_at = utcnow()
        else:
            _request_final_report_revision(db, project, task, note)

    elif waiting:  # gate before executing a sensitive task
        if approve:
            task.approval_granted = True
            transition(db, task, TaskStatus.READY, reason="approved by supervisor", **actor)
        else:
            transition(db, task, TaskStatus.CANCELLED, reason="rejected by supervisor", severity="warning", **actor)
            registry.block_dependents(db, task, reason=f"dependency rejected: {task.title}")
    # Otherwise: an action an agent proposed after its work was approved. The decision is
    # recorded; carrying it out is done by a human or by a configured integration.

    audit.record(
        db,
        action=f"approval.{approval.status}",
        entity_type="approval",
        entity_id=approval.id,
        project_id=approval.project_id,
        message=f"{approval.title}: {approval.status}" + (f" - {note}" if note else ""),
        details={"kind": approval.kind},
        **actor,
    )
    return approval


def _request_final_report_revision(db: Session, project: Project, previous: Task, note: str | None) -> None:
    """Supervisor rejected the final delivery: the CEO revises the report with that feedback."""
    round_no = int(previous.input_data.get("round", 1)) + 1
    dependency_ids = list(db.scalars(select(TaskDependency.depends_on_id).where(TaskDependency.task_id == previous.id)))
    dependencies = [db.get(Task, dep_id) for dep_id in dependency_ids]
    project.status = ProjectStatus.IN_PROGRESS
    registry.create_task(
        db,
        project=project,
        kind=TaskKind.FINAL_REPORT,
        title=f"Final executive report (revision {round_no})",
        objective="Revise the final report and deliverable to address the supervisor's feedback.",
        idempotency_key=f"{project.id}:final:{round_no}",
        agent=db.get(Agent, previous.assigned_agent_id),
        created_by=db.get(Agent, previous.assigned_agent_id),
        depends_on=[d for d in dependencies if d is not None],
        input_data={"round": round_no, "supervisor_feedback": note or "Rejected without comment."},
    )


def cancel_pending_for_project(db: Session, project: Project, user_id, reason: str) -> None:
    for approval in db.scalars(
        select(Approval).where(Approval.project_id == project.id, Approval.status == ApprovalStatus.PENDING)
    ):
        approval.status = ApprovalStatus.REJECTED
        approval.decided_by_id = user_id
        approval.decision_note = reason
        approval.decided_at = utcnow()
