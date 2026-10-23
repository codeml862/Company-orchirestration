"""End-to-end workflow tests: real engine, real database, real tools; scripted model only."""

from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.db import session_scope
from app.governance.approvals import decide
from app.governance.controls import pause_project, resume_project, retry_task
from app.models import (
    Agent,
    AgentMessage,
    Approval,
    ApprovalKind,
    ApprovalStatus,
    Artifact,
    ArtifactKind,
    AuditLog,
    Execution,
    Project,
    ProjectStatus,
    Review,
    Task,
    TaskKind,
    TaskStatus,
    utcnow,
)
from app.orchestration import registry
from app.orchestration.engine import submit_project
from app.providers.router import ModelRouter
from app.worker import Worker
from tests.fakes import ScriptedCompany, ScriptedProvider


def run_until_idle(worker: Worker, limit: int = 200) -> list[str]:
    statuses = []
    for _ in range(limit):
        status = worker.run_once("test")
        if status is None:
            return statuses
        statuses.append(status)
    raise AssertionError(f"worker did not become idle: {statuses[-10:]}")


@pytest.fixture
def company():
    return ScriptedCompany()


@pytest.fixture
def worker(company, settings):
    return Worker(ModelRouter([ScriptedProvider(company)]), settings, name="test-worker")


def submit(project_id):
    with session_scope() as db:
        submit_project(db, db.get(Project, project_id))


def pending_approvals(project_id, kind=None):
    with session_scope() as db:
        stmt = select(Approval).where(Approval.project_id == project_id, Approval.status == ApprovalStatus.PENDING)
        if kind:
            stmt = stmt.where(Approval.kind == kind)
        return list(db.scalars(stmt))


def approve(approval_id, note=None, approve=True):
    with session_scope() as db:
        decide(db, db.get(Approval, approval_id), user_id=None, approve=approve, note=note)


def test_full_project_lifecycle(make_project, worker):
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)

    with session_scope() as db:
        project = db.get(Project, project_id)
        assert project.status == ProjectStatus.AWAITING_APPROVAL
        assert project.objective.startswith("Deliver a tested Python calculator")
        tasks = db.scalars(select(Task).where(Task.project_id == project_id)).all()
        assert all(t.status == TaskStatus.APPROVED for t in tasks), [(t.title, t.status) for t in tasks]
        kinds = {t.kind for t in tasks}
        assert kinds == set(TaskKind)

        # Nested delegation: Technology Coordinator -> Software Development Sub-Coordinator -> Backend Coding Agent.
        coding = db.scalar(select(Task).where(Task.project_id == project_id, Task.title == "Implement add()"))
        assert db.get(Agent, coding.assigned_agent_id).key == "backend_coding"
        assert db.get(Agent, coding.created_by_agent_id).key == "software_dev_subcoordinator"

        # Evidence was recorded by the platform from a real sandbox run, not taken from the agent's word.
        sandbox_evidence = [e for e in coding.evidence if e["tool"] == "sandbox.run_python"]
        assert sandbox_evidence and sandbox_evidence[0]["verified_by"] == "platform"
        assert sandbox_evidence[0]["result"]["exit_code"] == 0
        assert "2 passed" in sandbox_evidence[0]["result"]["stdout"]

        # Every specialist task passed an independent QA review by a different agent.
        executes = [t for t in tasks if t.kind == TaskKind.EXECUTE]
        for t in executes:
            reviews = db.scalars(select(Review).where(Review.task_id == t.id)).all()
            assert [r.verdict for r in reviews] == ["approved"]
            assert reviews[0].reviewer_agent_id != t.assigned_agent_id

        # Research package finished before the technology package was allocated (package dependency).
        research_report = db.scalar(select(Task).where(Task.title.like("Research and Strategy report%")))
        tech_alloc = db.scalar(select(Task).where(Task.title == "Technology: Build calculator module"))
        assert research_report.completed_at <= tech_alloc.started_at

        # Metrics are real: executions with tokens and cost, aggregated on the project.
        executions = db.scalars(select(Execution).where(Execution.project_id == project_id)).all()
        assert len(executions) == len(tasks)
        assert all(e.prompt_tokens > 0 and e.llm_calls >= 1 for e in executions)
        assert project.tokens_used == sum(e.prompt_tokens + e.completion_tokens for e in executions)
        assert project.spent_usd > 0

        # Structured messages and audit trail.
        assert db.scalar(select(func.count()).select_from(AgentMessage).where(AgentMessage.project_id == project_id))
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.project_id == project_id)) > 20

        files = {a.name for a in db.scalars(select(Artifact).where(Artifact.project_id == project_id))}
        assert {"calculator.py", "final-report.md"} <= files

    # Final delivery needs a human.
    [final_delivery] = pending_approvals(project_id, ApprovalKind.FINAL_DELIVERY)
    approve(final_delivery.id)
    with session_scope() as db:
        project = db.get(Project, project_id)
        assert project.status == ProjectStatus.COMPLETED
        assert project.final_report["objective_met"] is True


def test_qa_rejection_sends_work_back_with_feedback(make_project, worker, company):
    company.reject_attempts["Implement add()"] = 1
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)

    with session_scope() as db:
        task = db.scalar(select(Task).where(Task.title == "Implement add()"))
        assert task.status == TaskStatus.APPROVED
        assert task.attempt_count == 2
        assert task.feedback[0]["required_fixes"] == ["Handle negative numbers"]
        verdicts = [r.verdict for r in db.scalars(select(Review).where(Review.task_id == task.id).order_by(Review.created_at))]
        assert verdicts == ["rejected", "approved"]
        # Only the accepted attempt's deliverable remains.
        assert db.scalar(select(func.count()).select_from(Artifact).where(Artifact.task_id == task.id)) == 1


def test_exhausted_retries_fail_and_block_dependents_until_manual_retry(make_project, worker, company):
    company.reject_attempts["Implement add()"] = 99
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)

    with session_scope() as db:
        task = db.scalar(select(Task).where(Task.title == "Implement add()"))
        assert task.status == TaskStatus.FAILED
        assert task.attempt_count == task.max_attempts == 3
        final = db.scalar(select(Task).where(Task.project_id == project_id, Task.kind == TaskKind.FINAL_REPORT))
        assert final.status == TaskStatus.BLOCKED
        assert db.get(Project, project_id).status == ProjectStatus.IN_PROGRESS
        task_id = task.id

    company.reject_attempts["Implement add()"] = 0
    with session_scope() as db:
        retry_task(db, db.get(Task, task_id), user_id=None)
    run_until_idle(worker)
    with session_scope() as db:
        assert db.get(Task, task_id).status == TaskStatus.APPROVED
        assert db.get(Project, project_id).status == ProjectStatus.AWAITING_APPROVAL


def test_invalid_output_is_repaired(make_project, worker, company):
    company.invalid_first = {"analyze", "execute"}
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)
    with session_scope() as db:
        assert db.get(Project, project_id).status == ProjectStatus.AWAITING_APPROVAL
        analyze = db.scalar(select(Task).where(Task.project_id == project_id, Task.kind == TaskKind.ANALYZE))
        execution = db.scalar(select(Execution).where(Execution.task_id == analyze.id))
        assert execution.llm_calls == 2


def test_output_that_never_validates_fails_the_attempt(make_project, worker, company):
    company.always_fail = {"Write research note"}
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)
    with session_scope() as db:
        task = db.scalar(select(Task).where(Task.title == "Write research note"))
        assert task.status == TaskStatus.FAILED
        assert "output failed validation" in task.last_error
        assert db.scalar(select(func.count()).select_from(Review).where(Review.task_id == task.id)) == 0


def test_clarification_round_trip(make_project, worker, company):
    company.clarify_kinds = {"analyze"}
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)
    [clarification] = pending_approvals(project_id, ApprovalKind.CLARIFICATION)
    assert clarification.details["questions"] == ["Which Python version must be supported?"]

    approve(clarification.id, note="Python 3.12")
    run_until_idle(worker)
    with session_scope() as db:
        analyze = db.scalar(select(Task).where(Task.project_id == project_id, Task.kind == TaskKind.ANALYZE))
        assert analyze.status == TaskStatus.APPROVED
        assert analyze.attempt_count == 1  # asking for clarification does not consume a retry
        assert analyze.input_data["clarifications"][0]["answer"] == "Python 3.12"


def test_sensitive_assignment_waits_for_human_approval(make_project, worker, company):
    company.approval_assignment = "web_research"
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)
    [gate] = pending_approvals(project_id, ApprovalKind.EXTERNAL_ACTION)
    with session_scope() as db:
        task = db.get(Task, gate.task_id)
        assert task.status == TaskStatus.AWAITING_APPROVAL
        assert db.scalar(select(func.count()).select_from(Execution).where(Execution.task_id == task.id)) == 0

    approve(gate.id)
    run_until_idle(worker)
    with session_scope() as db:
        assert db.get(Task, gate.task_id).status == TaskStatus.APPROVED
        assert db.get(Project, project_id).status == ProjectStatus.AWAITING_APPROVAL


def test_rejected_gate_cancels_task_and_blocks_dependents(make_project, worker, company):
    company.approval_assignment = "web_research"
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)
    [gate] = pending_approvals(project_id, ApprovalKind.EXTERNAL_ACTION)
    approve(gate.id, approve=False, note="Not allowed")
    with session_scope() as db:
        assert db.get(Task, gate.task_id).status == TaskStatus.CANCELLED
        note = db.scalar(select(Task).where(Task.title == "Write research note"))
        assert note.status == TaskStatus.BLOCKED


def test_task_budget_overrun_requires_approval(make_project, worker):
    with session_scope() as db:
        ceo = db.scalar(select(Agent).where(Agent.key == "ceo"))
        ceo.max_tokens_per_task = 0  # budget is checked before every model call
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)
    [overrun] = pending_approvals(project_id, ApprovalKind.BUDGET_OVERRUN)
    assert overrun.details["scope"] == "task"
    with session_scope() as db:
        ceo = db.scalar(select(Agent).where(Agent.key == "ceo"))
        ceo.max_tokens_per_task = 80000
    approve(overrun.id)
    run_until_idle(worker)
    with session_scope() as db:
        analyze = db.scalar(select(Task).where(Task.project_id == project_id, Task.kind == TaskKind.ANALYZE))
        assert analyze.status == TaskStatus.APPROVED


def test_project_budget_stops_work(make_project, worker):
    from decimal import Decimal

    project_id, _ = make_project(budget_usd=Decimal("0.000001"))
    submit(project_id)
    run_until_idle(worker)
    approvals = pending_approvals(project_id, ApprovalKind.BUDGET_OVERRUN)
    assert approvals and approvals[0].details["scope"] == "project"


def test_paused_project_is_not_worked_on(make_project, worker):
    project_id, _ = make_project()
    submit(project_id)
    with session_scope() as db:
        pause_project(db, db.get(Project, project_id), user_id=None)
    assert run_until_idle(worker) == []
    with session_scope() as db:
        resume_project(db, db.get(Project, project_id), user_id=None)
    assert run_until_idle(worker)


def test_rejected_final_delivery_triggers_revision(make_project, worker):
    project_id, _ = make_project()
    submit(project_id)
    run_until_idle(worker)
    [delivery] = pending_approvals(project_id, ApprovalKind.FINAL_DELIVERY)
    approve(delivery.id, approve=False, note="Add an installation section.")
    run_until_idle(worker)
    with session_scope() as db:
        finals = db.scalars(
            select(Task).where(Task.project_id == project_id, Task.kind == TaskKind.FINAL_REPORT).order_by(Task.created_at)
        ).all()
        assert len(finals) == 2
        assert finals[1].input_data["supervisor_feedback"] == "Add an installation section."
        assert db.get(Project, project_id).status == ProjectStatus.AWAITING_APPROVAL
        deliverables = db.scalars(
            select(Artifact).where(Artifact.project_id == project_id, Artifact.kind == ArtifactKind.DELIVERABLE)
        ).all()
        assert len(deliverables) == 1


def test_expired_lease_is_recovered(make_project, settings):
    project_id, _ = make_project()
    submit(project_id)
    with session_scope() as db:
        task = registry.claim_next(db, "dead-worker", lease_seconds=60)
        task.lease_expires_at = utcnow() - timedelta(seconds=1)
        task_id = task.id
    with session_scope() as db:
        assert registry.reap_expired_leases(db) == 1
    with session_scope() as db:
        task = db.get(Task, task_id)
        assert task.status == TaskStatus.READY
        assert "lease expired" in task.last_error


def test_no_provider_means_no_work_is_lost(make_project, settings):
    project_id, _ = make_project()
    submit(project_id)
    worker = Worker(ModelRouter([]), settings, name="w")
    status = worker.run_once("t")
    assert status == "llm_unavailable"
    with session_scope() as db:
        task = db.scalar(select(Task).where(Task.project_id == project_id))
        assert task.status == TaskStatus.READY
        assert task.attempt_count == 0
