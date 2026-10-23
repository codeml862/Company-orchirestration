"""Task lifecycle state machine.

    PENDING -> READY -> RUNNING -> IN_REVIEW -> APPROVED
                 ^         |            |
                 |         +--(error)---+--(rejected)--> READY (retry) or FAILED
                 +---- AWAITING_APPROVAL / BLOCKED (human decision or intervention)

A task only reaches APPROVED with verified output: tasks that require review must pass
QA, and every other task must pass schema validation of its structured output.
"""

from sqlalchemy.orm import Session

from app import audit
from app.models import TERMINAL_TASK_STATUSES, Task, TaskStatus, utcnow

S = TaskStatus

ALLOWED_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    S.PENDING: {S.READY, S.BLOCKED, S.CANCELLED},
    S.READY: {S.RUNNING, S.PENDING, S.AWAITING_APPROVAL, S.BLOCKED, S.CANCELLED},
    S.RUNNING: {
        S.IN_REVIEW,
        S.APPROVED,
        S.READY,
        S.FAILED,
        S.AWAITING_APPROVAL,
        S.BLOCKED,
        S.CANCELLED,
    },
    S.IN_REVIEW: {S.APPROVED, S.READY, S.FAILED, S.BLOCKED, S.CANCELLED},
    S.AWAITING_APPROVAL: {S.READY, S.BLOCKED, S.CANCELLED},
    S.BLOCKED: {S.READY, S.PENDING, S.CANCELLED},
    S.FAILED: {S.READY, S.PENDING},  # manual retry by a supervisor
    S.APPROVED: set(),
    S.CANCELLED: set(),
}


class InvalidTransition(Exception):
    pass


def can_transition(current: str, new: str) -> bool:
    return TaskStatus(new) in ALLOWED_TRANSITIONS[TaskStatus(current)]


def transition(
    db: Session,
    task: Task,
    new_status: TaskStatus,
    *,
    reason: str = "",
    actor_type: str = "system",
    actor_id=None,
    severity: str = "info",
    details: dict | None = None,
) -> None:
    old = TaskStatus(task.status)
    if not can_transition(old, new_status):
        raise InvalidTransition(f"task {task.id}: {old} -> {new_status} is not allowed")

    task.status = new_status
    now = utcnow()
    if new_status == S.RUNNING:
        task.started_at = task.started_at or now
    if new_status in TERMINAL_TASK_STATUSES:
        task.completed_at = now
    if new_status != S.RUNNING:
        task.lease_owner = None
        task.lease_expires_at = None

    audit.record(
        db,
        action=f"task.{new_status}",
        entity_type="task",
        entity_id=task.id,
        actor_type=actor_type,
        actor_id=actor_id,
        project_id=task.project_id,
        severity=severity,
        message=f"{task.title}: {old} -> {new_status}" + (f" ({reason})" if reason else ""),
        details={"from": old, "to": new_status, "kind": task.kind, "reason": reason, **(details or {})},
    )
