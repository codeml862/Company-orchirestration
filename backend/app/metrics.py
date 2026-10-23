"""Operational and quality metrics, computed from recorded data (nothing is estimated in the UI)."""

import uuid
from datetime import timedelta

from sqlalchemy import and_, case, distinct, func, select
from sqlalchemy.orm import Session

from app.models import (
    Agent,
    Approval,
    ApprovalKind,
    ApprovalStatus,
    AuditLog,
    Department,
    Execution,
    ExecutionStatus,
    Project,
    ProjectStatus,
    Review,
    ReviewVerdict,
    Task,
    TaskKind,
    TaskStatus,
    utcnow,
)

ACTIVE_PROJECT = [
    ProjectStatus.SUBMITTED,
    ProjectStatus.IN_PROGRESS,
    ProjectStatus.AWAITING_APPROVAL,
    ProjectStatus.PAUSED,
]


def _ratio(numerator, denominator) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def quality_metrics(db: Session, department_id: uuid.UUID | None = None, client_id: uuid.UUID | None = None) -> dict:
    """Section 11 metrics over specialist work (EXECUTE tasks)."""
    task_filter = [Task.kind == TaskKind.EXECUTE]
    if department_id:
        task_filter.append(Task.department_id == department_id)
    if client_id:
        task_filter.append(Task.project_id.in_(select(Project.id).where(Project.client_id == client_id)))

    approved = db.scalar(select(func.count()).where(*task_filter, Task.status == TaskStatus.APPROVED)) or 0
    failed = db.scalar(select(func.count()).where(*task_filter, Task.status == TaskStatus.FAILED)) or 0
    reworked = (
        db.scalar(select(func.count()).where(*task_filter, Task.status == TaskStatus.APPROVED, Task.attempt_count > 1))
        or 0
    )
    avg_seconds = db.scalar(
        select(func.avg(func.extract("epoch", Task.completed_at - Task.started_at))).where(
            *task_filter, Task.status == TaskStatus.APPROVED
        )
    )
    with_deadline = db.scalar(
        select(func.count()).where(*task_filter, Task.status == TaskStatus.APPROVED, Task.deadline.is_not(None))
    )
    on_time = db.scalar(
        select(func.count()).where(
            *task_filter,
            Task.status == TaskStatus.APPROVED,
            Task.deadline.is_not(None),
            Task.completed_at <= Task.deadline,
        )
    )
    task_ids = select(Task.id).where(*task_filter)
    first_reviews = db.execute(
        select(
            func.count(),
            func.sum(case((Review.verdict == ReviewVerdict.APPROVED, 1), else_=0)),
        ).where(Review.attempt == 1, Review.task_id.in_(task_ids))
    ).one()

    exec_filter = []
    if department_id:
        exec_filter.append(Execution.agent_id.in_(select(Agent.id).where(Agent.department_id == department_id)))
    if client_id:
        exec_filter.append(Execution.project_id.in_(select(Project.id).where(Project.client_id == client_id)))
    executions, failed_executions, tokens, cost = db.execute(
        select(
            func.count(),
            func.sum(case((Execution.status == ExecutionStatus.FAILED, 1), else_=0)),
            func.coalesce(func.sum(Execution.prompt_tokens + Execution.completion_tokens), 0),
            func.coalesce(func.sum(Execution.cost_usd), 0),
        ).where(*exec_filter)
    ).one()

    all_tasks = db.scalar(
        select(func.count()).select_from(Task).where(*([Task.department_id == department_id] if department_id else []))
    )
    interventions = db.scalar(
        select(func.count(distinct(Approval.task_id))).where(
            Approval.kind != ApprovalKind.FINAL_DELIVERY,
            Approval.task_id.is_not(None),
            *(
                [Approval.task_id.in_(select(Task.id).where(Task.department_id == department_id))]
                if department_id
                else []
            ),
        )
    )
    return {
        "tasks_completed": approved,
        "tasks_failed": failed,
        "task_success_rate": _ratio(approved, approved + failed),
        "first_pass_acceptance_rate": _ratio(first_reviews[1] or 0, first_reviews[0]),
        "rework_rate": _ratio(reworked, approved),
        "mean_task_completion_seconds": round(float(avg_seconds), 1) if avg_seconds is not None else None,
        "cost_per_completed_task_usd": round(float(cost) / approved, 6) if approved else None,
        "token_consumption": int(tokens),
        "total_cost_usd": round(float(cost), 6),
        "executions": executions,
        "error_rate": _ratio(failed_executions or 0, executions),
        "human_intervention_rate": _ratio(interventions or 0, all_tasks),
        "sla_compliance": _ratio(on_time or 0, with_deadline),
    }


def agent_stats(db: Session, agent_ids: list[uuid.UUID] | None = None) -> dict[uuid.UUID, dict]:
    task_rows = db.execute(
        select(
            Task.assigned_agent_id,
            func.sum(case((Task.status == TaskStatus.RUNNING, 1), else_=0)),
            func.sum(case((Task.status.in_([TaskStatus.READY, TaskStatus.PENDING]), 1), else_=0)),
        )
        .where(Task.assigned_agent_id.is_not(None), *([Task.assigned_agent_id.in_(agent_ids)] if agent_ids else []))
        .group_by(Task.assigned_agent_id)
    ).all()
    exec_rows = db.execute(
        select(
            Execution.agent_id,
            func.count(),
            func.sum(case((Execution.status == ExecutionStatus.SUCCEEDED, 1), else_=0)),
            func.sum(case((Execution.status == ExecutionStatus.FAILED, 1), else_=0)),
            func.coalesce(func.sum(Execution.prompt_tokens + Execution.completion_tokens), 0),
            func.coalesce(func.sum(Execution.cost_usd), 0),
            func.avg(Execution.latency_ms),
        )
        .where(*([Execution.agent_id.in_(agent_ids)] if agent_ids else []))
        .group_by(Execution.agent_id)
    ).all()
    review_rows = db.execute(
        select(
            Task.assigned_agent_id,
            func.count(),
            func.sum(case((and_(Review.attempt == 1, Review.verdict == ReviewVerdict.APPROVED), 1), else_=0)),
        )
        .join(Task, Task.id == Review.task_id)
        .where(*([Task.assigned_agent_id.in_(agent_ids)] if agent_ids else []))
        .group_by(Task.assigned_agent_id)
    ).all()
    stats: dict[uuid.UUID, dict] = {}

    def base(agent_id):
        return stats.setdefault(
            agent_id,
            {
                "running_tasks": 0,
                "queued_tasks": 0,
                "executions": 0,
                "succeeded": 0,
                "failed": 0,
                "tokens": 0,
                "cost_usd": 0.0,
                "avg_latency_ms": None,
                "reviews": 0,
                "first_pass_approvals": 0,
            },
        )

    for agent_id, running, queued in task_rows:
        s = base(agent_id)
        s["running_tasks"], s["queued_tasks"] = int(running or 0), int(queued or 0)
    for agent_id, count, ok, bad, tokens, cost, latency in exec_rows:
        s = base(agent_id)
        s.update(
            executions=count,
            succeeded=int(ok or 0),
            failed=int(bad or 0),
            tokens=int(tokens),
            cost_usd=round(float(cost), 6),
            avg_latency_ms=round(float(latency), 1) if latency is not None else None,
        )
    for agent_id, count, first_pass in review_rows:
        s = base(agent_id)
        s["reviews"], s["first_pass_approvals"] = count, int(first_pass or 0)
    return stats


def with_status(agent: Agent, stats: dict | None) -> dict:
    s = dict(stats or {})
    defaults = {
        "running_tasks": 0,
        "queued_tasks": 0,
        "executions": 0,
        "succeeded": 0,
        "failed": 0,
        "tokens": 0,
        "cost_usd": 0.0,
        "avg_latency_ms": None,
        "reviews": 0,
        "first_pass_approvals": 0,
    }
    s = {**defaults, **s}
    s["status"] = "inactive" if not agent.is_active else ("working" if s["running_tasks"] else "idle")
    return s


def executive_dashboard(db: Session) -> dict:
    task_counts = dict(db.execute(select(Task.status, func.count()).group_by(Task.status)).all())
    projects_by_status = dict(db.execute(select(Project.status, func.count()).group_by(Project.status)).all())
    agents_total = db.scalar(select(func.count()).select_from(Agent)) or 0
    agents_active = db.scalar(select(func.count()).select_from(Agent).where(Agent.is_active)) or 0
    agents_working = (
        db.scalar(select(func.count(distinct(Task.assigned_agent_id))).where(Task.status == TaskStatus.RUNNING)) or 0
    )
    cost_30d = db.scalar(
        select(func.coalesce(func.sum(Execution.cost_usd), 0)).where(
            Execution.started_at >= utcnow() - timedelta(days=30)
        )
    )
    satisfaction = db.execute(
        select(func.avg(Project.satisfaction_score), func.count(Project.satisfaction_score))
    ).one()
    pending_approvals = dict(
        db.execute(
            select(Approval.kind, func.count()).where(Approval.status == ApprovalStatus.PENDING).group_by(Approval.kind)
        ).all()
    )
    alerts = db.scalars(
        select(AuditLog).where(AuditLog.severity.in_(["warning", "error"])).order_by(AuditLog.id.desc()).limit(15)
    ).all()

    departments = []
    for dept in db.scalars(select(Department).order_by(Department.sort_order)):
        q = quality_metrics(db, department_id=dept.id)
        running = db.scalar(
            select(func.count()).where(Task.department_id == dept.id, Task.status == TaskStatus.RUNNING)
        )
        departments.append(
            {
                "key": dept.key,
                "name": dept.name,
                "running_tasks": running,
                "tasks_completed": q["tasks_completed"],
                "tasks_failed": q["tasks_failed"],
                "first_pass_acceptance_rate": q["first_pass_acceptance_rate"],
                "mean_task_completion_seconds": q["mean_task_completion_seconds"],
                "total_cost_usd": q["total_cost_usd"],
            }
        )

    return {
        "projects": {
            "active": sum(projects_by_status.get(s, 0) for s in ACTIVE_PROJECT),
            "by_status": projects_by_status,
        },
        "agents": {"total": agents_total, "active": agents_active, "working": agents_working},
        "tasks": {
            "by_status": task_counts,
            "completed": task_counts.get(TaskStatus.APPROVED, 0),
            "failed": task_counts.get(TaskStatus.FAILED, 0),
        },
        "quality": quality_metrics(db),
        "cost": {"last_30_days_usd": round(float(cost_30d), 6)},
        "client_satisfaction": {
            "average": round(float(satisfaction[0]), 2) if satisfaction[0] is not None else None,
            "responses": satisfaction[1],
        },
        "pending_approvals": pending_approvals,
        "alerts": [
            {
                "id": a.id,
                "severity": a.severity,
                "message": a.message,
                "project_id": str(a.project_id) if a.project_id else None,
                "created_at": a.created_at.isoformat(),
            }
            for a in alerts
        ],
        "departments": departments,
    }
