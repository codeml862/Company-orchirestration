"""Autopilot: decides routine approvals so projects run end to end without waiting for people.

Each client has an autonomy level (Client.autonomy_level):

* supervised - every approval waits for a human; the autopilot does nothing.
* autonomous - the autopilot answers unanswered clarifications after a timeout, extends budgets
  within limits and releases final deliveries that pass a quality gate (or sends them back to the
  CEO for revision). External actions, spending and hiring go to a human.
* full - like autonomous, and it also approves external actions, spending and hiring decisions.

Production changes and irreversible actions always go to a human, at every level.

A decision goes through `decide()`, exactly like a human's, and is recorded in the audit log with
the rule that produced it (actor "system"). When a rule's limit is reached the approval stays
pending for the supervisor console, marked as escalated with the reason; it is evaluated again
only if the client's autonomy level changes.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.config import Settings, get_settings
from app.governance.approvals import decide
from app.models import (
    Approval,
    ApprovalKind,
    ApprovalStatus,
    AutonomyLevel,
    Client,
    Project,
    Task,
    TaskKind,
    TaskStatus,
    utcnow,
)

ALWAYS_HUMAN = {ApprovalKind.PRODUCTION_CHANGE, ApprovalKind.IRREVERSIBLE}
FULL_AUTONOMY_ONLY = {ApprovalKind.EXTERNAL_ACTION, ApprovalKind.SPEND, ApprovalKind.HIRING_DECISION}
FAILED_WORK = (TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.BLOCKED)


@dataclass
class Verdict:
    action: Literal["approve", "reject", "escalate", "wait"]
    reason: str
    # The decision note; for a clarification it is the answer the agent receives.
    note: str | None = None


def _label(kind: str) -> str:
    return kind.replace("_", " ")


def _clarification(approval: Approval, settings: Settings, now: datetime) -> Verdict:
    hours = settings.autopilot_clarification_hours
    if now - approval.created_at < timedelta(hours=hours):
        return Verdict("wait", f"waiting up to {hours:g}h for the client's answer")
    return Verdict(
        "approve",
        f"no answer from the client within {hours:g}h",
        note=(
            f"The client did not answer within {hours:g} hours. Proceed with reasonable, conservative "
            "assumptions and state each assumption explicitly in your output."
        ),
    )


def _budget_overrun(db: Session, approval: Approval, settings: Settings) -> Verdict:
    if approval.details.get("scope") == "project":
        limit = settings.autopilot_max_project_budget_extensions
        earlier = db.scalars(
            select(Approval).where(
                Approval.project_id == approval.project_id,
                Approval.kind == ApprovalKind.BUDGET_OVERRUN,
                Approval.status == ApprovalStatus.APPROVED,
                Approval.decided_by_id.is_(None),
                Approval.id != approval.id,
            )
        )
        used = sum(1 for a in earlier if a.details.get("scope") == "project")
        if used >= limit:
            return Verdict("escalate", f"project budget already extended {used} time(s) (limit {limit})")
        return Verdict("approve", f"project budget extension {used + 1} of {limit} (+50%)")

    limit = settings.autopilot_max_task_budget_extensions
    task = db.get(Task, approval.task_id) if approval.task_id else None
    if task is None:
        return Verdict("escalate", "the task this budget belongs to no longer exists")
    used = int(task.input_data.get("budget_extensions", 0))
    if used >= limit:
        return Verdict("escalate", f"this task's budget was already extended {used} time(s) (limit {limit})")
    return Verdict("approve", f"task budget extension {used + 1} of {limit}")


def _final_delivery(db: Session, approval: Approval, settings: Settings) -> Verdict:
    """Quality gate: release only work the final report and QA both say is done."""
    project = db.get(Project, approval.project_id)
    failed = db.scalars(
        select(Task.title).where(
            Task.project_id == approval.project_id, Task.kind == TaskKind.EXECUTE, Task.status.in_(FAILED_WORK)
        )
    ).all()
    if failed:
        # Revising the report cannot fix work that never passed QA.
        return Verdict("escalate", f"{len(failed)} work task(s) did not pass QA: {'; '.join(failed[:3])}")

    report = (project.final_report if project else None) or {}
    problems = []
    if report.get("objective_met") is not True:
        problems.append("the report says the client's objective was not met")
    unmet = [o.get("outcome", "?") for o in report.get("outcomes", []) if o.get("status") != "met"]
    if unmet:
        problems.append(f"outcomes not fully met: {'; '.join(unmet[:5])}")
    if not problems:
        return Verdict("approve", "quality gate passed: objective met, every outcome met, all work approved by QA")

    limit = settings.autopilot_max_delivery_revisions
    task = db.get(Task, approval.task_id) if approval.task_id else None
    round_no = int(task.input_data.get("round", 1)) if task else limit + 1
    if round_no > limit:
        return Verdict("escalate", f"quality gate still failing after {limit} revision(s): {'; '.join(problems)}")
    return Verdict(
        "reject",
        f"quality gate failed, revision {round_no} of {limit}: {'; '.join(problems)}",
        note=(
            "Automatic quality gate: " + "; ".join(problems) + ". Revise the final report and deliverable so "
            "every expected outcome is met, or explain precisely what is missing and why."
        ),
    )


def evaluate(db: Session, approval: Approval, level: str, settings: Settings, now: datetime) -> Verdict:
    kind = approval.kind
    if kind == ApprovalKind.CLARIFICATION:
        return _clarification(approval, settings, now)
    if kind == ApprovalKind.BUDGET_OVERRUN:
        return _budget_overrun(db, approval, settings)
    if kind == ApprovalKind.FINAL_DELIVERY:
        return _final_delivery(db, approval, settings)
    if kind in ALWAYS_HUMAN:
        return Verdict("escalate", f"{_label(kind)} always needs a human decision")
    if kind in FULL_AUTONOMY_ONLY and level == AutonomyLevel.FULL:
        return Verdict("approve", f"autonomy level 'full' allows {_label(kind)}")
    return Verdict("escalate", f"{_label(kind)} needs a human at autonomy level '{level}'")


def sweep(db: Session, settings: Settings | None = None) -> dict[str, int]:
    """Decide every pending approval the autopilot may decide. Safe to run from several workers."""
    settings = settings or get_settings()
    now = utcnow()
    counts = {"approved": 0, "rejected": 0, "escalated": 0}
    rows = db.execute(
        select(Approval, Client.autonomy_level)
        .join(Project, Project.id == Approval.project_id)
        .join(Client, Client.id == Project.client_id)
        .where(Approval.status == ApprovalStatus.PENDING, Client.autonomy_level != AutonomyLevel.SUPERVISED)
        .order_by(Approval.created_at)
        .with_for_update(of=Approval, skip_locked=True)
    ).all()
    for approval, level in rows:
        previous = (approval.details or {}).get("autopilot") or {}
        if previous.get("decision") == "escalated" and previous.get("level") == level:
            continue
        verdict = evaluate(db, approval, level, settings, now)
        if verdict.action == "wait":
            continue
        decision = {"approve": "approved", "reject": "rejected", "escalate": "escalated"}[verdict.action]
        approval.details = {
            **approval.details,
            "autopilot": {"decision": decision, "reason": verdict.reason, "level": level, "at": now.isoformat()},
        }
        counts[decision] += 1
        if verdict.action == "escalate":
            audit.record(
                db,
                action="autopilot.escalated",
                entity_type="approval",
                entity_id=approval.id,
                project_id=approval.project_id,
                severity="warning",
                message=f"Autopilot needs a human: {approval.title} ({verdict.reason})",
                details={"kind": approval.kind, "reason": verdict.reason},
            )
            continue
        decide(
            db,
            approval,
            user_id=None,
            approve=verdict.action == "approve",
            note=verdict.note or f"Autopilot: {verdict.reason}",
            actor_type="system",
        )
    db.flush()
    return counts
