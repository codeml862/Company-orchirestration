from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user, is_staff, require_staff
from app.metrics import agent_stats, executive_dashboard, quality_metrics, with_status
from app.models import Agent, Department, Project, Task, TaskKind, TaskStatus, User
from app.providers.router import build_router_from_settings
from app.schemas import AgentOut, TaskOut

router = APIRouter(prefix="/api", tags=["dashboard"])

QUEUE_STATUSES = [
    TaskStatus.RUNNING,
    TaskStatus.READY,
    TaskStatus.IN_REVIEW,
    TaskStatus.AWAITING_APPROVAL,
    TaskStatus.BLOCKED,
    TaskStatus.PENDING,
]


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    settings = get_settings()
    return {
        "status": "ok",
        "database": "ok",
        "llm_providers_configured": len(build_router_from_settings().providers),
        "sandbox_backend": settings.sandbox_backend,
        "environment": settings.env,
    }


@router.get("/dashboard/executive")
def executive(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    data = executive_dashboard(db)
    data["llm_providers_configured"] = len(build_router_from_settings().providers)
    return data


@router.get("/dashboard/quality")
def quality(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if is_staff(user):
        return quality_metrics(db)
    return quality_metrics(db, client_id=user.client_id)


@router.get("/dashboard/departments/{key}")
def department_dashboard(key: str, db: Session = Depends(get_db), _: User = Depends(require_staff)):
    department = db.scalar(select(Department).where(Department.key == key))
    if department is None:
        raise HTTPException(404, "department not found")
    agents = list(db.scalars(select(Agent).where(Agent.department_id == department.id).order_by(Agent.name)))
    stats = agent_stats(db, [a.id for a in agents])
    workload = dict(
        db.execute(
            select(Task.status, func.count()).where(Task.department_id == department.id).group_by(Task.status)
        ).all()
    )
    queue = db.scalars(
        select(Task)
        .where(Task.department_id == department.id, Task.status.in_(QUEUE_STATUSES))
        .order_by(Task.priority, Task.created_at)
        .limit(100)
    ).all()
    reports = db.scalars(
        select(Task)
        .where(
            Task.department_id == department.id,
            Task.kind == TaskKind.CONSOLIDATE,
            Task.status == TaskStatus.APPROVED,
        )
        .order_by(Task.completed_at.desc())
        .limit(20)
    ).all()
    projects = {
        p.id: p.title for p in db.scalars(select(Project).where(Project.id.in_({r.project_id for r in reports})))
    }
    return {
        "department": {"key": department.key, "name": department.name, "description": department.description},
        "team": [
            {**AgentOut.model_validate(a).model_dump(mode="json"), "stats": with_status(a, stats.get(a.id))}
            for a in agents
        ],
        "workload": workload,
        "queue": [TaskOut.model_validate(t).model_dump(mode="json") for t in queue],
        "metrics": quality_metrics(db, department_id=department.id),
        "reports": [
            {
                "task_id": str(r.id),
                "project_id": str(r.project_id),
                "project_title": projects.get(r.project_id),
                "title": r.title,
                "summary": (r.result or {}).get("summary"),
                "report": (r.result or {}).get("report"),
                "status": (r.result or {}).get("status"),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in reports
        ],
    }
