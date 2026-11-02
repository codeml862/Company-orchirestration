"""Load the company catalog (departments + agent definitions) and sync it into the database.

The YAML catalog is the source of truth for the default organization. Sync is idempotent:
it creates missing departments and agents and updates catalog-managed agents. Agents an
operator has edited in the UI (`customized = True`) keep their edits.

`AICO_ENABLED_DEPARTMENTS` limits the company to some departments. Departments left out are
removed with their agents; an agent that already has work history (or was customized) is only
deactivated, so nothing that references it breaks. Enabling the department again restores it.
Departments added in the app (`added_in_app`: a catalog department switched on, or a custom one)
are always kept.
"""

from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.config import get_settings
from app.models import (
    Agent,
    AgentMessage,
    AgentRole,
    Approval,
    Artifact,
    Department,
    Execution,
    Review,
    Task,
    TaskKind,
)
from app.tools.registry import TOOLS

# Every column that records an agent's work; an agent referenced here is never deleted.
AGENT_HISTORY = (
    Task.assigned_agent_id,
    Task.created_by_agent_id,
    Execution.agent_id,
    Review.reviewer_agent_id,
    AgentMessage.sender_agent_id,
    AgentMessage.recipient_agent_id,
    Approval.requested_by_agent_id,
    Artifact.agent_id,
)

CATALOG_PATH = Path(__file__).parent / "catalog" / "company.yaml"

ROLE_DEFAULTS: dict[str, dict] = {
    AgentRole.CEO: {
        "task_kinds": [TaskKind.ANALYZE, TaskKind.FINAL_REPORT],
        "model_tier": "strong",
        "max_tokens_per_task": 80000,
        "max_cost_usd_per_task": "2.0",
    },
    AgentRole.DIRECTOR: {"task_kinds": [TaskKind.ALLOCATE, TaskKind.CONSOLIDATE], "model_tier": "strong"},
    AgentRole.COORDINATOR: {"task_kinds": [TaskKind.ALLOCATE, TaskKind.CONSOLIDATE], "model_tier": "strong"},
    AgentRole.SUB_COORDINATOR: {"task_kinds": [TaskKind.ALLOCATE, TaskKind.CONSOLIDATE], "model_tier": "strong"},
    AgentRole.SPECIALIST: {"task_kinds": [TaskKind.EXECUTE], "model_tier": "standard"},
}

DEFAULT_ESCALATION: dict[str, list[str]] = {
    AgentRole.CEO: [
        "Escalate to the human supervisor any sensitive, expensive, irreversible or externally visible action.",
    ],
    AgentRole.DIRECTOR: [
        "Escalate blocked work and cross-department conflicts to the CEO Agent.",
    ],
    AgentRole.COORDINATOR: [
        "Escalate tasks that are blocked or have exhausted their retries to the CEO Agent.",
        "Request clarification instead of guessing when a work package is ambiguous.",
    ],
    AgentRole.SUB_COORDINATOR: [
        "Escalate tasks that are blocked or have exhausted their retries to your coordinator.",
    ],
    AgentRole.SPECIALIST: [
        "Request clarification when instructions are ambiguous or required inputs are missing.",
        "Never perform an external action yourself; propose it for human approval.",
    ],
}

DEFAULT_QUALITY: dict[str, list[str]] = {
    AgentRole.SPECIALIST: [
        "Output fully addresses the task objective and every acceptance criterion.",
        "Every claim is backed by evidence (sources, real test output, calculations).",
        "Output follows the required structured format.",
    ],
    AgentRole.COORDINATOR: [
        "Every assigned task has a single owner, clear acceptance criteria and correct dependencies.",
        "Department reports reflect only approved, evidenced work.",
    ],
}

DEFAULT_REQUIRED_INPUTS: dict[str, list[str]] = {
    AgentRole.CEO: ["client request", "requested deliverables", "budget and deadline"],
    AgentRole.SPECIALIST: [
        "task objective",
        "acceptance criteria",
        "approved outputs of dependency tasks",
        "relevant project files",
    ],
}


@dataclass
class AgentSpec:
    key: str
    name: str
    department: str
    role_type: str
    reports_to: str | None = None
    task_kinds: list[str] = field(default_factory=list)
    model_tier: str = "standard"
    description: str = ""
    responsibilities: list[str] = field(default_factory=list)
    instructions: str = ""
    required_inputs: list[str] = field(default_factory=list)
    output_requirements: str = ""
    tools: list[str] = field(default_factory=list)
    quality_criteria: list[str] = field(default_factory=list)
    escalation_rules: list[str] = field(default_factory=list)
    max_retries: int = 2
    timeout_seconds: int = 300
    max_tokens_per_task: int = 60000
    max_cost_usd_per_task: str = "1.0"


class CatalogError(Exception):
    pass


def load_catalog(path: Path = CATALOG_PATH) -> tuple[list[dict], list[AgentSpec]]:
    data = yaml.safe_load(path.read_text())
    departments = data["departments"]
    dept_keys = {d["key"] for d in departments}
    specs: list[AgentSpec] = []
    for raw in data["agents"]:
        role = raw.get("role_type")
        if role not in set(AgentRole):
            raise CatalogError(f"{raw.get('key')}: unknown role_type {role!r}")
        merged = {**ROLE_DEFAULTS[role], **raw}
        merged.setdefault("escalation_rules", [])
        merged["escalation_rules"] = list(merged["escalation_rules"]) + DEFAULT_ESCALATION[role]
        if not merged.get("quality_criteria"):
            merged["quality_criteria"] = DEFAULT_QUALITY.get(role, DEFAULT_QUALITY[AgentRole.COORDINATOR])
        if not merged.get("required_inputs"):
            merged["required_inputs"] = DEFAULT_REQUIRED_INPUTS.get(role, ["work package", "project objective"])
        merged["task_kinds"] = [str(k) for k in merged["task_kinds"]]
        spec = AgentSpec(**merged)
        specs.append(spec)
    _validate(dept_keys, specs)
    return departments, specs


def _validate(dept_keys: set[str], specs: list[AgentSpec]) -> None:
    keys = [s.key for s in specs]
    if len(keys) != len(set(keys)):
        raise CatalogError("duplicate agent keys in catalog")
    by_key = {s.key: s for s in specs}
    valid_kinds = set(TaskKind)
    for s in specs:
        if s.department not in dept_keys:
            raise CatalogError(f"{s.key}: unknown department {s.department!r}")
        if s.reports_to and s.reports_to not in by_key:
            raise CatalogError(f"{s.key}: reports_to unknown agent {s.reports_to!r}")
        if s.role_type != AgentRole.CEO and not s.reports_to:
            raise CatalogError(f"{s.key}: every agent except the CEO must report to someone")
        unknown_tools = set(s.tools) - set(TOOLS)
        if unknown_tools:
            raise CatalogError(f"{s.key}: unknown tools {sorted(unknown_tools)}")
        bad_kinds = set(s.task_kinds) - valid_kinds
        if bad_kinds:
            raise CatalogError(f"{s.key}: unknown task kinds {sorted(bad_kinds)}")
    # The reporting structure must be a tree rooted at the CEO.
    for s in specs:
        seen = set()
        current = s
        while current.reports_to:
            if current.key in seen:
                raise CatalogError(f"reporting cycle involving {s.key}")
            seen.add(current.key)
            current = by_key[current.reports_to]
        if current.role_type != AgentRole.CEO:
            raise CatalogError(f"{s.key}: reporting chain does not reach the CEO")
    for kind in (TaskKind.ANALYZE, TaskKind.PLAN, TaskKind.REVIEW, TaskKind.FINAL_REPORT):
        if not any(kind in s.task_kinds for s in specs):
            raise CatalogError(f"no agent can perform {kind} tasks")


def enabled_subset(
    departments: list[dict], specs: list[AgentSpec], extra: set[str] = frozenset()
) -> tuple[list[dict], list[AgentSpec]]:
    """The catalog restricted to AICO_ENABLED_DEPARTMENTS plus `extra` (departments switched on in the app),
    checked to still be a working company."""
    wanted = {k.strip() for k in get_settings().enabled_departments.split(",") if k.strip()}
    if not wanted:
        return departments, specs
    catalog_keys = {d["key"] for d in departments}
    unknown = wanted - catalog_keys
    if unknown:
        raise CatalogError(f"AICO_ENABLED_DEPARTMENTS names unknown departments: {sorted(unknown)}")
    wanted |= set(extra) & catalog_keys
    specs = [s for s in specs if s.department in wanted]
    try:
        _validate(wanted, specs)
    except CatalogError as exc:
        raise CatalogError(
            f"AICO_ENABLED_DEPARTMENTS={','.join(sorted(wanted))} is not a working company ({exc}). "
            "The workflow needs 'executive' (CEO) and 'operations' (planning and QA) plus a delivery department."
        ) from exc
    return [d for d in departments if d["key"] in wanted], specs


def _has_history(db: Session, agent: Agent) -> bool:
    return any(db.scalar(select(column).where(column == agent.id).limit(1)) for column in AGENT_HISTORY)


def _retire_departments(db: Session, keep: set[str], stats: dict) -> None:
    """Remove departments outside `keep`, with their agents; agents with history or edits are deactivated."""
    for dept in db.scalars(select(Department).where(Department.key.not_in(keep))):
        agents = list(db.scalars(select(Agent).where(Agent.department_id == dept.id)))
        kept = [a for a in agents if a.customized or _has_history(db, a)]
        removed = [a for a in agents if a not in kept]
        removed_ids = {a.id for a in removed}
        for agent in db.scalars(select(Agent).where(Agent.reports_to_id.in_(removed_ids))):
            agent.reports_to_id = None
        db.flush()
        for agent in removed:
            db.delete(agent)
        for agent in kept:
            agent.is_active = False
        stats["agents_removed"] += len(removed)
        stats["agents_deactivated"] += len(kept)
        db.flush()
        if not kept and db.scalar(select(Task.id).where(Task.department_id == dept.id).limit(1)) is None:
            db.delete(dept)
            stats["departments_removed"] += 1
    db.flush()


def sync_catalog(db: Session, path: Path = CATALOG_PATH) -> dict:
    added_in_app = set(db.scalars(select(Department.key).where(Department.added_in_app)))
    departments, specs = enabled_subset(*load_catalog(path), extra=added_in_app)
    stats = {
        "departments_created": 0,
        "agents_created": 0,
        "agents_updated": 0,
        "agents_skipped": 0,
        "departments_removed": 0,
        "agents_removed": 0,
        "agents_deactivated": 0,
    }

    dept_by_key: dict[str, Department] = {d.key: d for d in db.scalars(select(Department))}
    for order, d in enumerate(departments):
        dept = dept_by_key.get(d["key"])
        if dept is None:
            dept = Department(key=d["key"])
            db.add(dept)
            dept_by_key[d["key"]] = dept
            stats["departments_created"] += 1
        dept.name = d["name"]
        dept.description = d.get("description", "")
        dept.sort_order = order
    db.flush()

    agent_by_key: dict[str, Agent] = {a.key: a for a in db.scalars(select(Agent))}
    for s in specs:
        agent = agent_by_key.get(s.key)
        if agent is None:
            agent = Agent(key=s.key)
            db.add(agent)
            agent_by_key[s.key] = agent
            stats["agents_created"] += 1
        elif agent.customized:
            stats["agents_skipped"] += 1
            continue
        else:
            stats["agents_updated"] += 1
        # A catalog-managed agent is only ever inactive because its department was disabled
        # (deactivating in the UI marks it customized), so a synced agent is active again.
        agent.is_active = True
        agent.name = s.name
        agent.department_id = dept_by_key[s.department].id
        agent.role_type = s.role_type
        agent.description = s.description
        agent.responsibilities = s.responsibilities
        agent.system_instructions = s.instructions.strip()
        agent.required_inputs = s.required_inputs
        agent.output_requirements = s.output_requirements
        agent.allowed_tools = s.tools
        agent.task_kinds = s.task_kinds
        agent.model_tier = s.model_tier
        agent.max_retries = s.max_retries
        agent.timeout_seconds = s.timeout_seconds
        agent.max_tokens_per_task = s.max_tokens_per_task
        agent.max_cost_usd_per_task = Decimal(str(s.max_cost_usd_per_task))
        agent.quality_criteria = s.quality_criteria
        agent.escalation_rules = s.escalation_rules
    db.flush()

    for s in specs:
        agent = agent_by_key[s.key]
        if agent.customized:
            continue
        agent.reports_to_id = agent_by_key[s.reports_to].id if s.reports_to else None
    db.flush()

    _retire_departments(db, {d["key"] for d in departments} | added_in_app, stats)
    audit.record(db, action="catalog.synced", entity_type="catalog", message="Agent catalog synced", details=stats)
    return stats
