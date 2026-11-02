import re
import secrets
import uuid
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit
from app.agents.catalog import ROLE_DEFAULTS, CatalogError, load_catalog, sync_catalog
from app.db import get_db
from app.deps import current_user, is_staff, require_admin, require_staff
from app.metrics import agent_stats, department_overview, with_status
from app.models import (
    Agent,
    AgentMessage,
    AgentRole,
    Client,
    Department,
    Execution,
    Review,
    Task,
    TaskKind,
    User,
    UserRole,
)
from app.orchestration.engine import department_head
from app.schemas import (
    AgentCreate,
    AgentOut,
    AgentUpdate,
    AgentWithStats,
    CompanyAgentCreate,
    CompanyAgentUpdate,
    DepartmentCreate,
    DepartmentEnable,
    DepartmentOut,
    ExecutionOut,
    TaskOut,
)
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


@router.get("/departments/overview")
def departments_overview(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    return department_overview(db)


@router.get("/departments/catalog")
def department_catalog(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Catalog departments that are not part of the company yet, with the team each one brings."""
    departments, specs = load_catalog()
    existing = set(db.scalars(select(Department.key)))
    available = []
    for d in departments:
        if d["key"] in existing:
            continue
        team = [s for s in specs if s.department == d["key"]]
        head = next((s for s in team if s.role_type in (AgentRole.DIRECTOR, AgentRole.COORDINATOR)), None)
        available.append(
            {
                "key": d["key"],
                "name": d["name"],
                "description": d.get("description", ""),
                "head": head.name if head else None,
                "agent_count": len(team),
                "roles": dict(Counter(str(s.role_type) for s in team)),
                "agents": [s.name for s in team],
            }
        )
    return available


@router.post("/departments/enable", response_model=DepartmentOut, status_code=201)
def enable_department(body: DepartmentEnable, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """Switch on a catalog department: it is created with its whole team and kept by later catalog syncs."""
    departments, _ = load_catalog()
    found = next(((i, d) for i, d in enumerate(departments) if d["key"] == body.key), None)
    if found is None:
        raise HTTPException(404, f"there is no catalog department {body.key!r}")
    if db.scalar(select(Department).where(Department.key == body.key)):
        raise HTTPException(409, "this department is already part of the company")
    order, spec = found
    department = Department(
        key=spec["key"], name=spec["name"], description=spec.get("description", ""), sort_order=order, added_in_app=True
    )
    db.add(department)
    db.flush()
    try:
        stats = sync_catalog(db)
    except CatalogError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    audit.record(
        db,
        action="department.enabled",
        entity_type="department",
        entity_id=department.id,
        actor_type="user",
        actor_id=user.id,
        message=f"{department.name} added to the company with {stats['agents_created']} agents",
        details=stats,
    )
    db.commit()
    return department


@router.post("/departments", response_model=DepartmentOut, status_code=201)
def create_department(body: DepartmentCreate, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """A custom department. It receives work once it has a head (a director or coordinator under the CEO)."""
    if db.scalar(select(Department).where(Department.key == body.key)):
        raise HTTPException(409, "a department with this key already exists")
    if body.key in {d["key"] for d in load_catalog()[0]}:
        raise HTTPException(409, "this is a catalog department; switch it on from the catalog instead")
    department = Department(
        key=body.key,
        name=body.name.strip(),
        description=body.description.strip(),
        sort_order=(db.scalar(select(func.max(Department.sort_order))) or 0) + 1,
        added_in_app=True,
    )
    db.add(department)
    db.flush()
    audit.record(
        db,
        action="department.created",
        entity_type="department",
        entity_id=department.id,
        actor_type="user",
        actor_id=user.id,
        message=f"Department {department.name} created",
    )
    db.commit()
    return department


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
            "client_id": str(a.client_id) if a.client_id else None,
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


@router.get("/org-chart/links")
def collaboration_links(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    """Who actually worked with whom: assignments and messages between agents, and QA reviews of their work."""
    pairs: Counter = Counter()
    messages = select(AgentMessage.sender_agent_id, AgentMessage.recipient_agent_id).where(
        AgentMessage.sender_agent_id.is_not(None), AgentMessage.recipient_agent_id.is_not(None)
    )
    reviews = (
        select(Review.reviewer_agent_id, Task.assigned_agent_id)
        .join(Task, Task.id == Review.task_id)
        .where(Task.assigned_agent_id.is_not(None))
    )
    for a, b in [*db.execute(messages), *db.execute(reviews)]:
        if a and b and a != b:
            pairs[tuple(sorted((str(a), str(b))))] += 1
    return [{"source": a, "target": b, "weight": n} for (a, b), n in pairs.items()]


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


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:60] or "agent"


def _unique_key(db: Session, base: str) -> str:
    key, n = base, 2
    while db.scalar(select(Agent.id).where(Agent.key == key)):
        key, n = f"{base}_{n}", n + 1
    return key


@router.post("/agents", response_model=AgentWithStats, status_code=201)
def create_agent(body: AgentCreate, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    defaults = [str(k) for k in ROLE_DEFAULTS[body.role_type]["task_kinds"]]
    task_kinds = body.task_kinds if body.task_kinds is not None else defaults
    _validate_config(body.allowed_tools, task_kinds, None)
    if not task_kinds:
        raise HTTPException(422, "an agent needs at least one task kind")
    if body.key and db.scalar(select(Agent).where(Agent.key == body.key)):
        raise HTTPException(409, "agent key already exists")
    department = db.scalar(select(Department).where(Department.key == body.department_key))
    manager = db.scalar(select(Agent).where(Agent.key == body.reports_to_key))
    if department is None or manager is None:
        raise HTTPException(422, "unknown department_key or reports_to_key")
    # The reporting structure stays a tree of company agents rooted at the CEO.
    if not manager.is_active or manager.client_id is not None:
        raise HTTPException(422, "the manager must be an active company agent")
    if manager.role_type == AgentRole.SPECIALIST:
        raise HTTPException(422, "a specialist cannot manage other agents; choose a coordinator or director")
    if manager.role_type != AgentRole.CEO and manager.department_id != department.id:
        raise HTTPException(422, "the manager must work in the same department, or be the CEO")
    if body.role_type == AgentRole.SPECIALIST and manager.role_type == AgentRole.CEO:
        raise HTTPException(422, "specialists report to a department coordinator or director, not to the CEO")
    data = body.model_dump(exclude={"department_key", "reports_to_key", "key", "task_kinds"})
    agent = Agent(
        **data,
        key=body.key or _unique_key(db, _slug(body.name)),
        task_kinds=task_kinds,
        department_id=department.id,
        reports_to_id=manager.id,
        customized=True,
    )
    db.add(agent)
    db.flush()
    audit.record(
        db,
        action="agent.created",
        entity_type="agent",
        entity_id=agent.id,
        actor_type="user",
        actor_id=user.id,
        message=f"Agent {agent.name} created in {department.name}, reporting to {manager.name}",
    )
    db.commit()
    return _with_stats(db, [agent])[0]


# --------------------------------------------------------------------------- company-owned agents
# A client company may add its own specialists. Each joins one department's team, works only on
# that company's projects (see protocol.assignable_team) and its work is reviewed by company QA.


def _owner(db: Session, user: User, requested: uuid.UUID | None) -> uuid.UUID:
    if user.role == UserRole.CLIENT:
        return user.client_id
    if not is_staff(user):
        raise HTTPException(403, "insufficient permissions")
    if requested is None:
        raise HTTPException(422, "choose the client company this agent belongs to")
    if db.get(Client, requested) is None:
        raise HTTPException(422, "unknown client")
    return requested


def _company_agent(db: Session, user: User, agent_id: uuid.UUID) -> Agent:
    agent = db.get(Agent, agent_id)
    visible = (
        agent is not None
        and agent.client_id is not None
        and (is_staff(user) or (user.role == UserRole.CLIENT and agent.client_id == user.client_id))
    )
    if not visible:
        raise HTTPException(404, "agent not found")
    return agent


@router.get("/company/agents")
def company_agents(
    client_id: uuid.UUID | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    """Agents client companies created: a client sees its own, staff see one client's or all of them."""
    stmt = select(Agent).where(Agent.client_id.is_not(None)).order_by(Agent.name)
    if user.role == UserRole.CLIENT:
        stmt = stmt.where(Agent.client_id == user.client_id)
    elif not is_staff(user):
        raise HTTPException(403, "insufficient permissions")
    elif client_id:
        stmt = stmt.where(Agent.client_id == client_id)
    departments = []
    for d in db.scalars(select(Department).where(Department.key != "executive").order_by(Department.sort_order)):
        head = department_head(db, d.key)
        if head:
            departments.append(
                {"id": str(d.id), "key": d.key, "name": d.name, "description": d.description, "head": head.name}
            )
    return {
        "agents": _with_stats(db, list(db.scalars(stmt))),
        "departments": departments,
        "tools": describe_tools(list(TOOLS)),
    }


@router.post("/company/agents", response_model=AgentWithStats, status_code=201)
def create_company_agent(
    body: CompanyAgentCreate, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    owner = _owner(db, user, body.client_id)
    _validate_config(body.allowed_tools, None, None)
    head = department_head(db, body.department_key) if body.department_key != "executive" else None
    if head is None:
        raise HTTPException(422, "choose a department with a head; your agent joins that team")
    agent = Agent(
        key=_unique_key(db, f"{_slug(body.name)[:48]}_{secrets.token_hex(2)}"),
        name=body.name.strip(),
        client_id=owner,
        department_id=head.department_id,
        reports_to_id=head.id,
        role_type=AgentRole.SPECIALIST,
        description=body.description.strip(),
        responsibilities=[r.strip() for r in body.responsibilities if r.strip()],
        system_instructions=body.system_instructions.strip(),
        allowed_tools=body.allowed_tools,
        task_kinds=[TaskKind.EXECUTE],
        model_tier=body.model_tier,
        customized=True,
    )
    db.add(agent)
    db.flush()
    audit.record(
        db,
        action="agent.created",
        entity_type="agent",
        entity_id=agent.id,
        actor_type="user",
        actor_id=user.id,
        client_id=owner,
        message=f"Company agent {agent.name} created in {db.get(Department, head.department_id).name}",
    )
    db.commit()
    return _with_stats(db, [agent])[0]


@router.patch("/company/agents/{agent_id}", response_model=AgentWithStats)
def update_company_agent(
    agent_id: uuid.UUID, body: CompanyAgentUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    agent = _company_agent(db, user, agent_id)
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    _validate_config(changes.get("allowed_tools"), None, None)
    if "responsibilities" in changes:
        changes["responsibilities"] = [r.strip() for r in changes["responsibilities"] if r.strip()]
    for field, value in changes.items():
        setattr(agent, field, value.strip() if isinstance(value, str) else value)
    agent.version += 1
    audit.record(
        db,
        action="agent.updated",
        entity_type="agent",
        entity_id=agent.id,
        actor_type="user",
        actor_id=user.id,
        client_id=agent.client_id,
        message=f"Company agent {agent.name} updated (v{agent.version})",
        details={"fields": sorted(changes)},
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
