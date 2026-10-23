"""Persistent data model.

Every piece of state the platform shows (agent status, task progress, costs, the live
timeline) is derived from these tables. Nothing in the UI is hardcoded.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> uuid.UUID:
    return uuid.uuid4()


class UserRole(StrEnum):
    ADMIN = "admin"
    SUPERVISOR = "supervisor"  # human supervisor: approvals, exceptions, spending limits
    OPERATOR = "operator"  # internal staff: manage projects and agents, no approvals
    CLIENT = "client"  # external client: own projects only


class AgentRole(StrEnum):
    CEO = "ceo"
    DIRECTOR = "director"
    COORDINATOR = "coordinator"
    SUB_COORDINATOR = "sub_coordinator"
    SPECIALIST = "specialist"


class ProjectStatus(StrEnum):
    SUBMITTED = "submitted"
    IN_PROGRESS = "in_progress"
    AWAITING_APPROVAL = "awaiting_approval"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskKind(StrEnum):
    ANALYZE = "analyze"  # CEO: understand the request, define objective and outcomes
    PLAN = "plan"  # Task Planning Agent: department work packages + dependency graph
    ALLOCATE = "allocate"  # Coordinator / sub-coordinator: assign work to specialists
    EXECUTE = "execute"  # Specialist: do the work, return deliverables + evidence
    REVIEW = "review"  # QA: inspect an execute task's output, approve or reject
    CONSOLIDATE = "consolidate"  # Coordinator: department report from approved outputs
    FINAL_REPORT = "final_report"  # CEO: executive report and final deliverable


class TaskStatus(StrEnum):
    PENDING = "pending"  # waiting on dependencies
    READY = "ready"  # dependencies approved, can be claimed by a worker
    RUNNING = "running"  # claimed by a worker (has a lease)
    IN_REVIEW = "in_review"  # output submitted, waiting for QA verdict
    AWAITING_APPROVAL = "awaiting_approval"  # waiting for a human decision
    BLOCKED = "blocked"  # escalated: needs manual intervention
    APPROVED = "approved"  # terminal success: output verified
    FAILED = "failed"  # terminal failure: retries exhausted
    CANCELLED = "cancelled"  # terminal: cancelled by a human or project cancellation


TERMINAL_TASK_STATUSES = {TaskStatus.APPROVED, TaskStatus.FAILED, TaskStatus.CANCELLED}


class ExecutionStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class ReviewVerdict(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"


class ApprovalKind(StrEnum):
    EXTERNAL_ACTION = "external_action"  # communications, posting, contacting people
    SPEND = "spend"  # spending money
    HIRING_DECISION = "hiring_decision"  # hiring or rejecting candidates
    PRODUCTION_CHANGE = "production_change"  # modifying production infrastructure
    IRREVERSIBLE = "irreversible"
    BUDGET_OVERRUN = "budget_overrun"
    CLARIFICATION = "clarification"  # an agent needs an answer from a human
    FINAL_DELIVERY = "final_delivery"  # release deliverables to the client


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ArtifactKind(StrEnum):
    INPUT = "input"  # uploaded by the client
    WORK = "work"  # produced by an agent
    DELIVERABLE = "deliverable"  # approved final deliverable


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    contact_email: Mapped[str | None] = mapped_column(String(320))
    # When false, this client's data may only be sent to local / private model providers.
    allow_external_llm: Mapped[bool] = mapped_column(Boolean, default=False)
    data_retention_days: Mapped[int] = mapped_column(Integer, default=365)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32))
    client_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    client: Mapped[Client | None] = relationship()

    __table_args__ = (CheckConstraint("role <> 'client' OR client_id IS NOT NULL", name="client_users_have_client"),)


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(100), unique=True)  # stable human-readable id
    name: Mapped[str] = mapped_column(String(200))
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id"))
    role_type: Mapped[str] = mapped_column(String(32))
    reports_to_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    description: Mapped[str] = mapped_column(Text, default="")
    responsibilities: Mapped[list] = mapped_column(JSONB, default=list)
    system_instructions: Mapped[str] = mapped_column(Text, default="")
    required_inputs: Mapped[list] = mapped_column(JSONB, default=list)
    output_requirements: Mapped[str] = mapped_column(Text, default="")
    allowed_tools: Mapped[list] = mapped_column(JSONB, default=list)
    # Task kinds this agent may be assigned (e.g. QA agents: ["review"]).
    task_kinds: Mapped[list] = mapped_column(JSONB, default=list)
    model_tier: Mapped[str] = mapped_column(String(32), default="standard")
    model_override: Mapped[str | None] = mapped_column(String(200))  # "provider/model"
    temperature: Mapped[float] = mapped_column(Float, default=0.2)
    max_retries: Mapped[int] = mapped_column(Integer, default=2)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300)
    max_tokens_per_task: Mapped[int] = mapped_column(Integer, default=60000)
    max_cost_usd_per_task: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("1.0"))
    quality_criteria: Mapped[list] = mapped_column(JSONB, default=list)
    escalation_rules: Mapped[list] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # True when an operator edited the agent in the UI; catalog sync then leaves it alone.
    customized: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    department: Mapped[Department | None] = relationship()
    reports_to: Mapped["Agent | None"] = relationship(remote_side=[id])


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(300))
    request: Mapped[str] = mapped_column(Text)  # the client's original request (untrusted input)
    requested_deliverables: Mapped[list] = mapped_column(JSONB, default=list)
    objective: Mapped[str | None] = mapped_column(Text)  # defined by the CEO agent
    expected_outcomes: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(32), default=ProjectStatus.SUBMITTED)
    priority: Mapped[int] = mapped_column(Integer, default=3)  # 1 = highest
    budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    budget_tokens: Mapped[int | None] = mapped_column(Integer)
    spent_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"))
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    final_report: Mapped[dict | None] = mapped_column(JSONB)
    satisfaction_score: Mapped[int | None] = mapped_column(Integer)  # 1..5, given by the client
    satisfaction_comment: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    client: Mapped[Client] = relationship()

    __table_args__ = (
        CheckConstraint("satisfaction_score IS NULL OR satisfaction_score BETWEEN 1 AND 5"),
        Index("ix_projects_client_status", "client_id", "status"),
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(300))
    objective: Mapped[str] = mapped_column(Text)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id"))
    assigned_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    created_by_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    # For REVIEW tasks: the EXECUTE task under review. For CONSOLIDATE: the ALLOCATE task it closes.
    target_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(32), default=TaskStatus.PENDING)
    priority: Mapped[int] = mapped_column(Integer, default=3)
    input_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    acceptance_criteria: Mapped[list] = mapped_column(JSONB, default=list)
    result: Mapped[dict | None] = mapped_column(JSONB)
    evidence: Mapped[list] = mapped_column(JSONB, default=list)
    feedback: Mapped[list] = mapped_column(JSONB, default=list)  # QA rejections, for the next attempt
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    requires_review: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_kind: Mapped[str | None] = mapped_column(String(32))
    approval_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    depth: Mapped[int] = mapped_column(Integer, default=0)  # delegation depth
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_owner: Mapped[str | None] = mapped_column(String(200))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[str] = mapped_column(String(300), unique=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    assigned_agent: Mapped[Agent | None] = relationship(foreign_keys=[assigned_agent_id])
    department: Mapped[Department | None] = relationship()

    __table_args__ = (
        Index("ix_tasks_claimable", "status", "priority", "created_at"),
        Index("ix_tasks_project", "project_id", "status"),
        Index("ix_tasks_agent", "assigned_agent_id", "status"),
    )


class TaskDependency(Base):
    __tablename__ = "task_dependencies"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    depends_on_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)

    __table_args__ = (
        CheckConstraint("task_id <> depends_on_id", name="no_self_dependency"),
        Index("ix_task_dependencies_depends_on", "depends_on_id"),
    )


class Execution(Base):
    """One attempt of an agent working on a task, with its metrics."""

    __tablename__ = "executions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"))
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    attempt: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default=ExecutionStatus.RUNNING)
    worker_id: Mapped[str | None] = mapped_column(String(200))
    provider: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(200))
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    output: Mapped[dict | None] = mapped_column(JSONB)
    transcript: Mapped[list] = mapped_column(JSONB, default=list)  # LLM/tool steps, truncated
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_executions_task", "task_id"),
        Index("ix_executions_agent", "agent_id", "status"),
        Index("ix_executions_project", "project_id"),
    )


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    review_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    reviewer_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    attempt: Mapped[int] = mapped_column(Integer)
    verdict: Mapped[str] = mapped_column(String(32))
    score: Mapped[float | None] = mapped_column(Float)
    feedback: Mapped[str] = mapped_column(Text, default="")
    checks: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (Index("ix_reviews_task", "task_id"),)


class AgentMessage(Base):
    """Structured agent-to-agent message (the communication protocol)."""

    __tablename__ = "agent_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    sender_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    recipient_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    message_type: Mapped[str] = mapped_column(String(32))  # assignment | result | review | escalation
    objective: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (Index("ix_agent_messages_project", "project_id", "created_at"),)


class Approval(Base):
    """A decision that only a human may make."""

    __tablename__ = "approvals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(300))
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    requested_by_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    status: Mapped[str] = mapped_column(String(32), default=ApprovalStatus.PENDING)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_approvals_status", "status", "created_at"),)


class Artifact(Base):
    """A file or document: client uploads, agent work products and final deliverables."""

    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"))
    kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(200), default="text/plain")
    storage_key: Mapped[str] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (Index("ix_artifacts_project", "project_id", "kind"),)


class AuditLog(Base):
    """Append-only audit trail. Also the source of the live operations timeline."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_type: Mapped[str] = mapped_column(String(32))  # user | agent | system
    actor_id: Mapped[str | None] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str | None] = mapped_column(String(100))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    client_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    severity: Mapped[str] = mapped_column(String(16), default="info")  # info | warning | error
    message: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_audit_logs_project", "project_id", "id"),
        Index("ix_audit_logs_created", "created_at"),
    )
