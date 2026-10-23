import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.db import get_db
from app.deps import require_admin, require_staff
from app.metrics import agent_stats, with_status
from app.models import Agent, AgentRole, Department, Execution, Task, TaskKind, User
from app.schemas import AgentCreate, AgentOut, AgentUpdate, AgentWithStats, DepartmentOut, ExecutionOut, TaskOut
from app.tools.registry import TOOLS, describe_tools

router = APIRouter(prefix="/api", tags=["organization"])


def _with_stats(db: Session, agents: list[Agent]) -> list[AgentWithStats]:
    stats = agent_stats(db, [a.id for a in agents])
    return [
        AgentWithStats(**AgentOut.model_validate(a).model_dump(), stats=with_status(a, stats.get(a.id))) for a in agents
    ]


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    return db.scalars(select(Department).order_by(Department.sort_order)).all()


@router.get("/tools")
def list_tools(_: User = Depends(require_staff)):
    return describe_tools(list(TOOLS))


@router.get("/org-chart")
def org_chart(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    """The company hierarchy as a tree of agents (reporting lines) with live status."""
    agents = list(db.scalars(select(Agent).order_by(Agent.key)))
    departments = {d.id: d for d in db.scalars(select(Department))}
    stats = agent_stats(db)
    nodes = {
        a.id: {
            "id": str(a.id),
            "key": a.key,
            "name": a.name,
            "role_type": a.role_type,
            "department": departments[a.department_id].key if a.department_id else None,
            "department_name": departments[a.department_id].name if a.department_id else None,
            "is_active": a.is_active,
            "stats": with_status(a, stats.get(a.id)),
            "children": [],
        }
        for a in agents
    }
    roots = []
    role_order = {r: i for i, r in enumerate(AgentRole)}
    for a in sorted(agents, key=lambda a: (role_order.get(a.role_type, 9), a.name)):
        if a.reports_to_id and a.reports_to_id in nodes:
            nodes[a.reports_to_id]["children"].append(nodes[a.id])
        else:
            roots.append(nodes[a.id])
    return {"roots": roots, "agent_count": len(agents), "department_count": len(departments)}


@router.get("/agents", response_model=list[AgentWithStats])
def list_agents(
    department: str | None = None,
    role_type: str | None = None,
    active: bool | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    stmt = select(Agent).order_by(Agent.name)
    if department:
        stmt = stmt.join(Department, Department.id == Agent.department_id).where(Department.key == department)
    if role_type:
        stmt = stmt.where(Agent.role_type == role_type)
    if active is not None:
        stmt = stmt.where(Agent.is_active == active)
    return _with_stats(db, list(db.scalars(stmt)))


def _get_agent(db: Session, agent_id: uuid.UUID) -> Agent:
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(404, "agent not found")
    return agent


@router.get("/agents/{agent_id}", response_model=AgentWithStats)
def get_agent(agent_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_staff)):
    return _with_stats(db, [_get_agent(db, agent_id)])[0]


def _validate_config(tools: list[str] | None, kinds: list[str] | None, model_override: str | None) -> None:
    if tools is not None and set(tools) - set(TOOLS):
        raise HTTPException(422, f"unknown tools: {sorted(set(tools) - set(TOOLS))}")
    if kinds is not None and set(kinds) - set(TaskKind):
        raise HTTPException(422, f"unknown task kinds: {sorted(set(kinds) - set(TaskKind))}")
    if model_override and "/" not in model_override:
        raise HTTPException(422, "model_override must look like 'provider/model'")


@router.patch("/agents/{agent_id}", response_model=AgentWithStats)
def update_agent(
    agent_id: uuid.UUID, body: AgentUpdate, db: Session = Depends(get_db), user: User = Depends(require_staff)
):
    agent = _get_agent(db, agent_id)
    changes = body.model_dump(exclude_unset=True)
    _validate_config(changes.get("allowed_tools"), changes.get("task_kinds"), changes.get("model_override"))
    if changes.get("is_active") is False and agent.role_type == AgentRole.CEO:
        raise HTTPException(422, "the CEO agent cannot be deactivated")
    for field, value in changes.items():
        setattr(agent, field, value)
    agent.customized = True
    agent.version += 1
    audit.record(
        db,
        action="agent.updated",
        entity_type="agent",
        entity_id=agent.id,
        actor_type="user",
        actor_id=user.id,
        message=f"{agent.name} configuration updated (v{agent.version})",
        details={"fields": sorted(changes)},
    )
    db.commit()
    return _with_stats(db, [agent])[0]


@router.post("/agents", response_model=AgentWithStats, status_code=201)
def create_agent(body: AgentCreate, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    _validate_config(body.allowed_tools, body.task_kinds, None)
    if db.scalar(select(Agent).where(Agent.key == body.key)):
        raise HTTPException(409, "agent key already exists")
    department = db.scalar(select(Department).where(Department.key == body.department_key))
    manager = db.scalar(select(Agent).where(Agent.key == body.reports_to_key))
    if department is None or manager is None:
        raise HTTPException(422, "unknown department_key or reports_to_key")
    data = body.model_dump(exclude={"department_key", "reports_to_key"})
    agent = Agent(**data, department_id=department.id, reports_to_id=manager.id, customized=True)
    db.add(agent)
    db.flush()
    audit.record(
        db,
        action="agent.created",
        entity_type="agent",
        entity_id=agent.id,
        actor_type="user",
        actor_id=user.id,
        message=f"Agent {agent.name} created in {department.name}",
    )
    db.commit()
    return _with_stats(db, [agent])[0]


@router.get("/agents/{agent_id}/executions", response_model=list[ExecutionOut])
def agent_executions(
    agent_id: uuid.UUID,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    _get_agent(db, agent_id)
    return db.scalars(
        select(Execution).where(Execution.agent_id == agent_id).order_by(Execution.started_at.desc()).limit(limit)
    ).all()


@router.get("/agents/{agent_id}/tasks", response_model=list[TaskOut])
def agent_tasks(
    agent_id: uuid.UUID,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    _get_agent(db, agent_id)
    return db.scalars(
        select(Task).where(Task.assigned_agent_id == agent_id).order_by(Task.created_at.desc()).limit(limit)
    ).all()
