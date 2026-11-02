"""The autopilot decides routine approvals by policy, and hands everything else to a human."""

from datetime import timedelta

from sqlalchemy import func, select

from app.db import session_scope
from app.governance import autopilot
from app.governance.approvals import request_approval
from app.models import (
    Agent,
    Approval,
    ApprovalKind,
    ApprovalStatus,
    AuditLog,
    Client,
    Project,
    ProjectStatus,
    Task,
    TaskKind,
    TaskStatus,
    utcnow,
)
from app.orchestration import registry

GOOD_REPORT = {
    "executive_summary": "Delivered.",
    "objective_met": True,
    "outcomes": [{"outcome": "Working calculator", "status": "met", "evidence": "tests pass"}],
    "final_deliverable_markdown": "# Report",
}


def _setup(make_project, level, *, kind=TaskKind.EXECUTE, status=TaskStatus.AWAITING_APPROVAL, input_data=None):
    project_id, client_id = make_project()
    with session_scope() as db:
        db.get(Client, client_id).autonomy_level = level
        project = db.get(Project, project_id)
        project.status = ProjectStatus.IN_PROGRESS
        task = registry.create_task(
            db,
            project=project,
            kind=kind,
            title="Build the module",
            objective="Build it",
            idempotency_key=f"{project_id}:work",
            agent=db.scalar(select(Agent).where(Agent.key == "ceo")),
            input_data=input_data,
        )
        task.status = status
        return project_id, task.id


def _request(project_id, task_id, kind, details=None, age_hours=0.0):
    with session_scope() as db:
        task = db.get(Task, task_id)
        approval = request_approval(
            db, project_id=project_id, task=task, kind=kind, title=f"{kind} request", details=details or {}
        )
        approval.created_at = utcnow() - timedelta(hours=age_hours)
        return approval.id


def _sweep():
    with session_scope() as db:
        return autopilot.sweep(db)


def _approval(approval_id) -> Approval:
    with session_scope() as db:
        return db.get(Approval, approval_id)


def _task(task_id) -> Task:
    with session_scope() as db:
        return db.get(Task, task_id)


def _set_client_level(project_id, level):
    with session_scope() as db:
        db.get(Client, db.get(Project, project_id).client_id).autonomy_level = level


def test_supervised_clients_are_never_decided(make_project):
    project_id, task_id = _setup(make_project, "supervised")
    approval_id = _request(project_id, task_id, ApprovalKind.BUDGET_OVERRUN, {"scope": "task"})
    assert _sweep() == {"approved": 0, "rejected": 0, "escalated": 0}
    approval = _approval(approval_id)
    assert approval.status == ApprovalStatus.PENDING and "autopilot" not in approval.details


def test_task_budget_is_extended_up_to_the_limit_then_escalated(make_project):
    project_id, task_id = _setup(make_project, "autonomous")
    for extension in (1, 2):
        approval_id = _request(project_id, task_id, ApprovalKind.BUDGET_OVERRUN, {"scope": "task"})
        assert _sweep()["approved"] == 1
        approval = _approval(approval_id)
        assert approval.status == ApprovalStatus.APPROVED and approval.decided_by_id is None
        task = _task(task_id)
        assert task.status == TaskStatus.READY and task.input_data["budget_extensions"] == extension
        with session_scope() as db:
            db.get(Task, task_id).status = TaskStatus.AWAITING_APPROVAL

    third = _request(project_id, task_id, ApprovalKind.BUDGET_OVERRUN, {"scope": "task"})
    assert _sweep()["escalated"] == 1
    approval = _approval(third)
    assert approval.status == ApprovalStatus.PENDING
    assert approval.details["autopilot"]["decision"] == "escalated"
    assert "limit 2" in approval.details["autopilot"]["reason"]
    # Escalated once: later sweeps leave it to the human and do not log it again.
    assert _sweep() == {"approved": 0, "rejected": 0, "escalated": 0}
    with session_scope() as db:
        assert db.scalar(select(func.count()).where(AuditLog.action == "autopilot.escalated")) == 1


def test_project_budget_grows_twice_then_needs_a_human(make_project):
    project_id, task_id = _setup(make_project, "autonomous")
    with session_scope() as db:
        project = db.get(Project, project_id)
        project.budget_usd, project.spent_usd = 10, 10
    for expected_budget in (15, 22.5):
        approval_id = _request(project_id, task_id, ApprovalKind.BUDGET_OVERRUN, {"scope": "project"})
        _sweep()
        assert _approval(approval_id).status == ApprovalStatus.APPROVED
        with session_scope() as db:
            project = db.get(Project, project_id)
            assert float(project.budget_usd) == expected_budget
            project.spent_usd = project.budget_usd
            db.get(Task, task_id).status = TaskStatus.AWAITING_APPROVAL
    third = _request(project_id, task_id, ApprovalKind.BUDGET_OVERRUN, {"scope": "project"})
    _sweep()
    assert _approval(third).details["autopilot"]["decision"] == "escalated"


def test_unanswered_clarification_proceeds_with_assumptions_after_the_timeout(make_project, settings):
    project_id, task_id = _setup(make_project, "autonomous")
    questions = {"questions": ["Which currency?"]}
    recent = _request(project_id, task_id, ApprovalKind.CLARIFICATION, questions, age_hours=1)
    assert _sweep() == {"approved": 0, "rejected": 0, "escalated": 0}
    assert _approval(recent).status == ApprovalStatus.PENDING  # the client still has time to answer

    with session_scope() as db:
        db.get(Approval, recent).created_at = utcnow() - timedelta(hours=settings.autopilot_clarification_hours + 1)
    _sweep()
    assert _approval(recent).status == ApprovalStatus.APPROVED
    task = _task(task_id)
    assert task.status == TaskStatus.READY
    answer = task.input_data["clarifications"][-1]
    assert answer["questions"] == ["Which currency?"] and "did not answer" in answer["answer"]


def _final_delivery(make_project, level, report, round_no=None):
    project_id, task_id = _setup(
        make_project,
        level,
        kind=TaskKind.FINAL_REPORT,
        status=TaskStatus.APPROVED,
        input_data={"round": round_no} if round_no else None,
    )
    with session_scope() as db:
        project = db.get(Project, project_id)
        project.final_report = report
        project.status = ProjectStatus.AWAITING_APPROVAL
    return project_id, _request(project_id, task_id, ApprovalKind.FINAL_DELIVERY)


def test_delivery_that_passes_the_quality_gate_is_released(make_project):
    project_id, approval_id = _final_delivery(make_project, "autonomous", GOOD_REPORT)
    _sweep()
    assert _approval(approval_id).status == ApprovalStatus.APPROVED
    with session_scope() as db:
        assert db.get(Project, project_id).status == ProjectStatus.COMPLETED


def test_delivery_that_fails_the_gate_goes_back_to_the_ceo(make_project):
    report = {**GOOD_REPORT, "outcomes": [{"outcome": "Docs", "status": "partially_met", "evidence": "half"}]}
    project_id, approval_id = _final_delivery(make_project, "autonomous", report)
    _sweep()
    approval = _approval(approval_id)
    assert approval.status == ApprovalStatus.REJECTED
    assert "outcomes not fully met: Docs" in approval.decision_note
    with session_scope() as db:
        assert db.get(Project, project_id).status == ProjectStatus.IN_PROGRESS
        revision = db.scalar(select(Task).where(Task.project_id == project_id, Task.idempotency_key.like("%:final:2")))
        assert revision is not None and "quality gate" in revision.input_data["supervisor_feedback"]


def test_delivery_still_failing_after_the_revision_limit_is_escalated(make_project, settings):
    report = {**GOOD_REPORT, "objective_met": False}
    _, approval_id = _final_delivery(
        make_project, "autonomous", report, round_no=settings.autopilot_max_delivery_revisions + 1
    )
    _sweep()
    approval = _approval(approval_id)
    assert approval.status == ApprovalStatus.PENDING
    assert "still failing" in approval.details["autopilot"]["reason"]


def test_failed_work_is_never_released_automatically(make_project):
    project_id, approval_id = _final_delivery(make_project, "full", GOOD_REPORT)
    with session_scope() as db:
        project = db.get(Project, project_id)
        failed = registry.create_task(
            db, project=project, kind=TaskKind.EXECUTE, title="Payment module", objective="x", idempotency_key="failed"
        )
        failed.status = TaskStatus.FAILED
    _sweep()
    approval = _approval(approval_id)
    assert approval.status == ApprovalStatus.PENDING
    assert "did not pass QA: Payment module" in approval.details["autopilot"]["reason"]


def test_external_actions_need_full_autonomy(make_project):
    project_id, task_id = _setup(make_project, "autonomous")
    approval_id = _request(project_id, task_id, ApprovalKind.EXTERNAL_ACTION)
    _sweep()
    assert _approval(approval_id).details["autopilot"]["decision"] == "escalated"

    # Raising the client's autonomy re-evaluates what was escalated under the old level.
    _set_client_level(project_id, "full")
    assert _sweep()["approved"] == 1
    assert _approval(approval_id).status == ApprovalStatus.APPROVED
    task = _task(task_id)
    assert task.approval_granted and task.status == TaskStatus.READY


def test_irreversible_actions_always_need_a_human(make_project):
    project_id, task_id = _setup(make_project, "full")
    approval_id = _request(project_id, task_id, ApprovalKind.IRREVERSIBLE)
    _sweep()
    approval = _approval(approval_id)
    assert approval.status == ApprovalStatus.PENDING
    assert approval.details["autopilot"]["reason"] == "irreversible always needs a human decision"
