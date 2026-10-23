"""API request/response models."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import UserRole


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- auth & users


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(ORM):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    client_id: uuid.UUID | None
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=10, max_length=200)
    role: UserRole
    client_id: uuid.UUID | None = None


class ClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact_email: EmailStr | None = None
    allow_external_llm: bool = False
    data_retention_days: int = Field(default=365, ge=1, le=3650)


class ClientOut(ORM):
    id: uuid.UUID
    name: str
    contact_email: str | None
    allow_external_llm: bool
    data_retention_days: int
    created_at: datetime


# ---------------------------------------------------------------- organization


class DepartmentOut(ORM):
    id: uuid.UUID
    key: str
    name: str
    description: str
    sort_order: int


class AgentOut(ORM):
    id: uuid.UUID
    key: str
    name: str
    department_id: uuid.UUID | None
    role_type: str
    reports_to_id: uuid.UUID | None
    description: str
    responsibilities: list
    system_instructions: str
    required_inputs: list
    output_requirements: str
    allowed_tools: list
    task_kinds: list
    model_tier: str
    model_override: str | None
    temperature: float
    max_retries: int
    timeout_seconds: int
    max_tokens_per_task: int
    max_cost_usd_per_task: Decimal
    quality_criteria: list
    escalation_rules: list
    is_active: bool
    customized: bool
    version: int
    updated_at: datetime


class AgentStats(BaseModel):
    status: str  # working | idle | inactive
    running_tasks: int
    queued_tasks: int
    executions: int
    succeeded: int
    failed: int
    tokens: int
    cost_usd: float
    avg_latency_ms: float | None
    reviews: int
    first_pass_approvals: int


class AgentWithStats(AgentOut):
    stats: AgentStats


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    responsibilities: list[str] | None = None
    system_instructions: str | None = None
    output_requirements: str | None = None
    allowed_tools: list[str] | None = None
    task_kinds: list[str] | None = None
    model_tier: str | None = Field(default=None, pattern="^(fast|standard|strong)$")
    model_override: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_retries: int | None = Field(default=None, ge=0, le=10)
    timeout_seconds: int | None = Field(default=None, ge=10, le=7200)
    max_tokens_per_task: int | None = Field(default=None, ge=1000, le=10_000_000)
    max_cost_usd_per_task: Decimal | None = Field(default=None, ge=0, le=1000)
    quality_criteria: list[str] | None = None
    escalation_rules: list[str] | None = None
    is_active: bool | None = None


class AgentCreate(BaseModel):
    key: str = Field(pattern="^[a-z0-9_]{2,100}$")
    name: str = Field(min_length=1, max_length=200)
    department_key: str
    role_type: str = Field(pattern="^(director|coordinator|sub_coordinator|specialist)$")
    reports_to_key: str
    description: str = ""
    responsibilities: list[str] = []
    system_instructions: str = ""
    output_requirements: str = ""
    allowed_tools: list[str] = []
    task_kinds: list[str] = ["execute"]
    model_tier: str = Field(default="standard", pattern="^(fast|standard|strong)$")
    quality_criteria: list[str] = []
    escalation_rules: list[str] = []


# ---------------------------------------------------------------- projects & tasks


class ProjectCreate(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    request: str = Field(min_length=10, max_length=50_000)
    requested_deliverables: list[str] = []
    client_id: uuid.UUID | None = None  # staff only; clients always create for themselves
    priority: int = Field(default=3, ge=1, le=5)
    budget_usd: Decimal | None = Field(default=None, ge=0)
    budget_tokens: int | None = Field(default=None, ge=1000)
    deadline: datetime | None = None
    submit: bool = True

    @field_validator("requested_deliverables")
    @classmethod
    def _limit(cls, v: list[str]) -> list[str]:
        if len(v) > 20:
            raise ValueError("at most 20 deliverables")
        return v


class ProjectOut(ORM):
    id: uuid.UUID
    client_id: uuid.UUID
    title: str
    request: str
    requested_deliverables: list
    objective: str | None
    expected_outcomes: list
    status: str
    priority: int
    budget_usd: Decimal | None
    budget_tokens: int | None
    spent_usd: Decimal
    tokens_used: int
    deadline: datetime | None
    final_report: dict | None
    satisfaction_score: int | None
    satisfaction_comment: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class ProjectSummary(ProjectOut):
    client_name: str
    task_counts: dict[str, int]
    pending_approvals: int
    needs_client_input: bool


class ProjectUpdate(BaseModel):
    priority: int | None = Field(default=None, ge=1, le=5)
    budget_usd: Decimal | None = Field(default=None, ge=0)
    budget_tokens: int | None = Field(default=None, ge=1000)
    deadline: datetime | None = None


class FeedbackIn(BaseModel):
    score: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=5000)


class TaskOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    parent_task_id: uuid.UUID | None
    target_task_id: uuid.UUID | None
    kind: str
    title: str
    objective: str
    department_id: uuid.UUID | None
    assigned_agent_id: uuid.UUID | None
    created_by_agent_id: uuid.UUID | None
    status: str
    priority: int
    acceptance_criteria: list
    result: dict | None
    evidence: list
    feedback: list
    attempt_count: int
    max_attempts: int
    requires_review: bool
    requires_approval: bool
    approval_kind: str | None
    deadline: datetime | None
    last_error: str | None
    tokens_used: int
    cost_usd: Decimal
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    depends_on: list[uuid.UUID] = []


class ExecutionOut(ORM):
    id: uuid.UUID
    task_id: uuid.UUID
    agent_id: uuid.UUID
    project_id: uuid.UUID
    attempt: int
    status: str
    worker_id: str | None
    provider: str | None
    model: str | None
    llm_calls: int
    tool_calls: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: Decimal
    latency_ms: int | None
    output: dict | None
    transcript: list
    error: str | None
    started_at: datetime
    finished_at: datetime | None


class ReviewOut(ORM):
    id: uuid.UUID
    task_id: uuid.UUID
    reviewer_agent_id: uuid.UUID | None
    attempt: int
    verdict: str
    score: float | None
    feedback: str
    checks: list
    created_at: datetime


class MessageOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID | None
    sender_agent_id: uuid.UUID | None
    recipient_agent_id: uuid.UUID | None
    message_type: str
    objective: str
    payload: dict
    created_at: datetime


class TaskDetail(TaskOut):
    executions: list[ExecutionOut]
    reviews: list[ReviewOut]
    messages: list[MessageOut]


class ReassignIn(BaseModel):
    agent_id: uuid.UUID


class ArtifactOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID | None
    agent_id: uuid.UUID | None
    kind: str
    name: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: datetime


# ---------------------------------------------------------------- approvals & audit


class ApprovalOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID | None
    kind: str
    title: str
    details: dict
    requested_by_agent_id: uuid.UUID | None
    status: str
    decided_by_id: uuid.UUID | None
    decision_note: str | None
    created_at: datetime
    decided_at: datetime | None


class DecisionIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=10_000)


class AuditOut(ORM):
    id: int
    actor_type: str
    actor_id: str | None
    action: str
    entity_type: str
    entity_id: str | None
    project_id: uuid.UUID | None
    severity: str
    message: str
    details: dict
    created_at: datetime


TokenResponse.model_rebuild()
