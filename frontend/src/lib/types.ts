// Types mirror the backend API schemas (backend/app/schemas.py).

export type Role = "admin" | "supervisor" | "operator" | "client";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  client_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Department {
  id: string;
  key: string;
  name: string;
  description: string;
  sort_order: number;
}

export interface AgentStats {
  status: "working" | "idle" | "inactive";
  running_tasks: number;
  queued_tasks: number;
  executions: number;
  succeeded: number;
  failed: number;
  tokens: number;
  cost_usd: number;
  avg_latency_ms: number | null;
  reviews: number;
  first_pass_approvals: number;
}

export interface Agent {
  id: string;
  key: string;
  name: string;
  department_id: string | null;
  role_type: string;
  reports_to_id: string | null;
  description: string;
  responsibilities: string[];
  system_instructions: string;
  required_inputs: string[];
  output_requirements: string;
  allowed_tools: string[];
  task_kinds: string[];
  model_tier: string;
  model_override: string | null;
  temperature: number;
  max_retries: number;
  timeout_seconds: number;
  max_tokens_per_task: number;
  max_cost_usd_per_task: string;
  quality_criteria: string[];
  escalation_rules: string[];
  is_active: boolean;
  customized: boolean;
  version: number;
  updated_at: string;
  stats: AgentStats;
}

export interface OrgNode {
  id: string;
  key: string;
  name: string;
  role_type: string;
  department: string | null;
  department_name: string | null;
  is_active: boolean;
  stats: AgentStats;
  children: OrgNode[];
}

export interface Project {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  request: string;
  requested_deliverables: string[];
  objective: string | null;
  expected_outcomes: string[];
  status: string;
  priority: number;
  budget_usd: string | null;
  budget_tokens: number | null;
  spent_usd: string;
  tokens_used: number;
  deadline: string | null;
  final_report: FinalReport | null;
  satisfaction_score: number | null;
  satisfaction_comment: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  task_counts: Record<string, number>;
  pending_approvals: number;
  needs_client_input: boolean;
}

export interface FinalReport {
  executive_summary: string;
  objective_met: boolean;
  outcomes: { outcome: string; status: string; evidence: string }[];
  risks?: string[];
  next_steps?: string[];
  final_deliverable_markdown: string;
}

export interface Task {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  target_task_id: string | null;
  kind: string;
  title: string;
  objective: string;
  department_id: string | null;
  assigned_agent_id: string | null;
  created_by_agent_id: string | null;
  status: string;
  priority: number;
  acceptance_criteria: string[];
  result: Record<string, unknown> | null;
  evidence: Record<string, unknown>[];
  feedback: { attempt: number; reviewer: string; feedback: string; required_fixes: string[] }[];
  attempt_count: number;
  max_attempts: number;
  requires_review: boolean;
  requires_approval: boolean;
  approval_kind: string | null;
  deadline: string | null;
  last_error: string | null;
  tokens_used: number;
  cost_usd: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  depends_on: string[];
}

export interface ClientTask {
  id: string;
  title: string;
  kind: string;
  status: string;
  department: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface TranscriptEntry {
  type: string;
  [key: string]: unknown;
}

export interface Execution {
  id: string;
  task_id: string;
  agent_id: string;
  attempt: number;
  status: string;
  provider: string | null;
  model: string | null;
  llm_calls: number;
  tool_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: string;
  latency_ms: number | null;
  output: Record<string, unknown> | null;
  transcript: TranscriptEntry[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Review {
  id: string;
  task_id: string;
  reviewer_agent_id: string | null;
  attempt: number;
  verdict: string;
  score: number | null;
  feedback: string;
  checks: Record<string, unknown>[];
  created_at: string;
}

export interface Message {
  id: string;
  task_id: string | null;
  sender_agent_id: string | null;
  recipient_agent_id: string | null;
  message_type: string;
  objective: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TaskDetail extends Task {
  executions: Execution[];
  reviews: Review[];
  messages: Message[];
}

export interface Artifact {
  id: string;
  project_id: string;
  task_id: string | null;
  agent_id: string | null;
  kind: string;
  name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface Approval {
  id: string;
  project_id: string;
  task_id: string | null;
  kind: string;
  title: string;
  details: Record<string, unknown>;
  requested_by_agent_id: string | null;
  status: string;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface AuditEvent {
  id: number;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  severity: "info" | "warning" | "error";
  message: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface QualityMetrics {
  tasks_completed: number;
  tasks_failed: number;
  task_success_rate: number | null;
  first_pass_acceptance_rate: number | null;
  rework_rate: number | null;
  mean_task_completion_seconds: number | null;
  cost_per_completed_task_usd: number | null;
  token_consumption: number;
  total_cost_usd: number;
  executions: number;
  error_rate: number | null;
  human_intervention_rate: number | null;
  sla_compliance: number | null;
}

export interface ExecutiveDashboard {
  projects: { active: number; by_status: Record<string, number> };
  agents: { total: number; active: number; working: number };
  tasks: { by_status: Record<string, number>; completed: number; failed: number };
  quality: QualityMetrics;
  cost: { last_30_days_usd: number };
  client_satisfaction: { average: number | null; responses: number };
  pending_approvals: Record<string, number>;
  alerts: { id: number; severity: string; message: string; project_id: string | null; created_at: string }[];
  departments: {
    key: string;
    name: string;
    running_tasks: number;
    tasks_completed: number;
    tasks_failed: number;
    first_pass_acceptance_rate: number | null;
    mean_task_completion_seconds: number | null;
    total_cost_usd: number;
  }[];
  llm_providers_configured: number;
}

export interface DepartmentDashboard {
  department: { key: string; name: string; description: string };
  team: (Omit<Agent, "stats"> & { stats: AgentStats })[];
  workload: Record<string, number>;
  queue: Task[];
  metrics: QualityMetrics;
  reports: {
    task_id: string;
    project_id: string;
    project_title: string | null;
    title: string;
    summary: string | null;
    report: string | null;
    status: string | null;
    completed_at: string | null;
  }[];
}

export interface Client {
  id: string;
  name: string;
  contact_email: string | null;
  allow_external_llm: boolean;
  data_retention_days: number;
  created_at: string;
}
