"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Coins,
  Gauge,
  ListChecks,
  Loader2,
  ShieldCheck,
  Timer,
  Undo2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { ExecutionLog } from "@/components/tasks/ExecutionLog";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { patch } from "@/lib/api";
import { isStaff, useAuth } from "@/lib/auth";
import { formatDuration, formatNumber, formatPercent, formatUsd, humanize, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Department, Execution, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

const TASK_KINDS = ["analyze", "plan", "allocate", "execute", "review", "consolidate", "final_report"];
const TIERS = { fast: "Fast · cheapest", standard: "Standard", strong: "Strong · best quality" };

type Form = {
  description: string;
  responsibilities: string;
  system_instructions: string;
  output_requirements: string;
  allowed_tools: string[];
  task_kinds: string[];
  model_tier: string;
  model_override: string;
  temperature: string;
  max_retries: string;
  timeout_seconds: string;
  max_tokens_per_task: string;
  max_cost_usd_per_task: string;
  quality_criteria: string;
  escalation_rules: string;
};

function toForm(a: Agent): Form {
  return {
    description: a.description,
    responsibilities: a.responsibilities.join("\n"),
    system_instructions: a.system_instructions,
    output_requirements: a.output_requirements,
    allowed_tools: [...a.allowed_tools].sort(),
    task_kinds: [...a.task_kinds].sort(),
    model_tier: a.model_tier,
    model_override: a.model_override ?? "",
    temperature: String(a.temperature),
    max_retries: String(a.max_retries),
    timeout_seconds: String(a.timeout_seconds),
    max_tokens_per_task: String(a.max_tokens_per_task),
    max_cost_usd_per_task: String(Number(a.max_cost_usd_per_task)),
    quality_criteria: a.quality_criteria.join("\n"),
    escalation_rules: a.escalation_rules.join("\n"),
  };
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Same limits the API enforces (app/schemas.py AgentUpdate), checked before sending. */
function validate(f: Form): Partial<Record<keyof Form, string>> {
  const errors: Partial<Record<keyof Form, string>> = {};
  const num = (key: keyof Form, min: number, max: number, integer: boolean, label: string) => {
    const raw = String(f[key]).trim();
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n)) errors[key] = `${label} is required`;
    else if (integer && !Number.isInteger(n)) errors[key] = `${label} must be a whole number`;
    else if (n < min || n > max) errors[key] = `${label} must be between ${formatNumber(min)} and ${formatNumber(max)}`;
  };
  num("temperature", 0, 2, false, "Temperature");
  num("max_retries", 0, 10, true, "Max retries");
  num("timeout_seconds", 10, 7200, true, "Timeout");
  num("max_tokens_per_task", 1000, 10_000_000, true, "Token limit");
  num("max_cost_usd_per_task", 0, 1000, false, "Cost limit");
  if (f.model_override.trim() && !/^[^/\s]+\/\S+$/.test(f.model_override.trim())) {
    errors.model_override = "Use the form provider/model, e.g. groq/openai/gpt-oss-120b";
  }
  if (!f.task_kinds.length) errors.task_kinds = "Select at least one task kind, or the agent can never be assigned work";
  if (!f.system_instructions.trim()) errors.system_instructions = "System instructions are required";
  return errors;
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{title}</div>
      {items.length ? (
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canEdit = isStaff(user?.role);
  const agentQuery = useApi<Agent>(`/api/agents/${id}`, 15000);
  const { data: agent, setData: setAgent } = agentQuery;
  const { data: allAgents } = useApi<Agent[]>("/api/agents", 30000);
  const { data: departments } = useApi<Department[]>("/api/departments");
  const { data: tools } = useApi<{ name: string; description: string }[]>("/api/tools");
  const { data: executions, error: executionsError } = useApi<Execution[]>(`/api/agents/${id}/executions?limit=30`, 15000);
  const { data: tasks, error: tasksError, reload: reloadTasks } = useApi<Task[]>(`/api/agents/${id}/tasks?limit=50`, 15000);

  const [baseline, setBaseline] = useState<Agent | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const dirty = Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(toForm(baseline)));
  const errors = useMemo(() => (form ? validate(form) : {}), [form]);
  const invalid = Object.keys(errors).length > 0;
  // Another user saved a newer version while this one has unsaved edits.
  const conflict = Boolean(dirty && agent && baseline && agent.version !== baseline.version);

  // Follow server updates while the form is untouched; never overwrite unsaved edits.
  useEffect(() => {
    if (!agent) return;
    if (!baseline || (!dirty && agent.version !== baseline.version) || agent.id !== baseline.id) {
      setBaseline(agent);
      setForm(toForm(agent));
    }
  }, [agent, baseline, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const agentMap = useMemo(() => new Map((allAgents ?? []).map((a) => [a.id, a])), [allAgents]);

  if (!agent || !form || !baseline) {
    if (agentQuery.error) {
      return (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/agents">
              <ArrowLeft /> All agents
            </Link>
          </Button>
          <PageError message={agentQuery.error} status={agentQuery.errorStatus} onRetry={agentQuery.reload} />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const s = agent.stats;
  const department = departments?.find((d) => d.id === agent.department_id);
  const manager = agent.reports_to_id ? agentMap.get(agent.reports_to_id) : undefined;
  const reports = (allAgents ?? []).filter((a) => a.reports_to_id === agent.id);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const toggle = (key: "allowed_tools" | "task_kinds", value: string) =>
    set(key, (form[key].includes(value) ? form[key].filter((v) => v !== value) : [...form[key], value]).sort());

  function discard() {
    setForm(toForm(agent!));
    setBaseline(agent);
    setSaveError(null);
  }

  async function save() {
    if (!form || invalid) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await patch<Agent>(`/api/agents/${id}`, {
        description: form.description.trim(),
        responsibilities: lines(form.responsibilities),
        system_instructions: form.system_instructions,
        output_requirements: form.output_requirements,
        allowed_tools: form.allowed_tools,
        task_kinds: form.task_kinds,
        model_tier: form.model_tier,
        model_override: form.model_override.trim() || null,
        temperature: Number(form.temperature),
        max_retries: Number(form.max_retries),
        timeout_seconds: Number(form.timeout_seconds),
        max_tokens_per_task: Number(form.max_tokens_per_task),
        max_cost_usd_per_task: form.max_cost_usd_per_task.trim(),
        quality_criteria: lines(form.quality_criteria),
        escalation_rules: lines(form.escalation_rules),
      });
      setAgent(updated);
      setBaseline(updated);
      setForm(toForm(updated));
      toast.success(`${updated.name} saved as version ${updated.version}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(active: boolean) {
    setToggling(true);
    try {
      const updated = await patch<Agent>(`/api/agents/${id}`, { is_active: active });
      setAgent(updated);
      // Keep unsaved edits; only the baseline version moves.
      if (!dirty) setForm(toForm(updated));
      setBaseline(updated);
      toast.success(active ? `${updated.name} is active again` : `${updated.name} deactivated: it receives no new work`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the agent's status");
    } finally {
      setToggling(false);
    }
  }

  const successRate = s.executions ? s.succeeded / s.executions : null;
  const firstPass = s.reviews ? s.first_pass_approvals / s.reviews : null;
  const textarea = (key: keyof Form, className: string, placeholder?: string) => (
    <Textarea
      id={key}
      className={className}
      value={form[key] as string}
      disabled={!canEdit}
      placeholder={placeholder}
      aria-invalid={Boolean(errors[key])}
      onChange={(e) => set(key, e.target.value as Form[typeof key])}
    />
  );
  const numberInput = (key: keyof Form, props: React.ComponentProps<"input">) => (
    <Input
      id={key}
      type="number"
      inputMode="decimal"
      value={form[key] as string}
      disabled={!canEdit}
      aria-invalid={Boolean(errors[key])}
      onChange={(e) => set(key, e.target.value as Form[typeof key])}
      {...props}
    />
  );

  return (
    <>
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/agents" className="hover:text-foreground">
          Agents
        </Link>
        {department && (
          <>
            <ChevronRight className="size-3.5" />
            <Link href={`/departments/${department.key}`} className="hover:text-foreground">
              {department.name}
            </Link>
          </>
        )}
        <ChevronRight className="size-3.5" />
        <span className="truncate text-foreground">{agent.name}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <AgentAvatar name={agent.name} role={agent.role_type} status={s.status} size="lg" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status={s.status} />
              <ToneBadge tone="violet">{humanize(agent.role_type)}</ToneBadge>
              {agent.customized && <ToneBadge tone="amber">Customized</ToneBadge>}
              <span>
                <code className="text-xs">{agent.key}</code> · v{agent.version} · updated {timeAgo(agent.updated_at)}
              </span>
            </div>
            {manager && (
              <div className="mt-1.5 text-sm text-muted-foreground">
                Reports to{" "}
                <Link href={`/agents/${manager.id}`} className="font-medium text-foreground hover:text-primary">
                  {manager.name}
                </Link>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SyncStatus
            updatedAt={agentQuery.updatedAt}
            refreshing={agentQuery.refreshing}
            error={agentQuery.error}
            onRefresh={agentQuery.reload}
          />
          {canEdit && (
            <Label className="flex h-8 items-center gap-2 rounded-lg border px-3 font-normal">
              {toggling ? <Loader2 className="size-4 animate-spin" /> : null}
              <Switch
                checked={agent.is_active}
                disabled={toggling || agent.role_type === "ceo"}
                onCheckedChange={(checked) => void setActive(checked)}
                aria-label="Agent active"
              />
              {agent.is_active ? "Active" : "Inactive"}
            </Label>
          )}
        </div>
      </div>

      {!agent.is_active && (
        <Alert className="mb-6 border-slate-200 bg-slate-50">
          <AlertTriangle />
          <AlertTitle>This agent is inactive</AlertTitle>
          <AlertDescription>It receives no new work. Tasks already assigned to it are blocked until reassigned.</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Workload"
          value={`${s.running_tasks} / ${s.queued_tasks}`}
          hint="running / queued"
          tone="violet"
          icon={<Activity />}
        />
        <StatCard
          label="Success rate"
          value={formatPercent(successRate)}
          hint={`${s.succeeded} of ${s.executions} executions${s.failed ? ` · ${s.failed} failed` : ""}`}
          tone={s.failed > s.succeeded ? "red" : "green"}
          icon={<CheckCircle2 />}
        />
        <StatCard
          label="QA first pass"
          value={formatPercent(firstPass)}
          hint={s.reviews ? `${s.first_pass_approvals} of ${s.reviews} reviews` : "no reviews yet"}
          tone="blue"
          icon={<ShieldCheck />}
        />
        <StatCard label="Tokens" value={formatNumber(s.tokens)} hint={`${formatUsd(s.cost_usd)} spent`} icon={<Coins />} />
        <StatCard
          label="Avg latency"
          value={formatDuration(s.avg_latency_ms !== null ? s.avg_latency_ms / 1000 : null)}
          hint="per execution"
          icon={<Timer />}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6 gap-5">
        <TabsList variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="configuration">
            Configuration
            {dirty && <span className="size-1.5 rounded-full bg-amber-500" aria-label="unsaved changes" />}
          </TabsTrigger>
          <TabsTrigger value="activity">
            Activity
            {tasks && tasks.length > 0 && <span className="text-xs text-muted-foreground">{tasks.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <SectionCard title="Role" className="lg:col-span-2">
              <div className="space-y-6">
                <p className="text-sm">{agent.description || "No description."}</p>
                <div className="grid gap-6 sm:grid-cols-2">
                  <ListBlock title="Responsibilities" items={agent.responsibilities} empty="None listed." />
                  <ListBlock title="Required inputs" items={agent.required_inputs} empty="None listed." />
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <ListBlock title="Quality criteria" items={agent.quality_criteria} empty="No extra criteria." />
                  <ListBlock title="Escalation rules" items={agent.escalation_rules} empty="Default escalation only." />
                </div>
                {agent.output_requirements && (
                  <div>
                    <div className="mb-1 text-sm font-medium">Output requirements</div>
                    <p className="text-sm text-muted-foreground">{agent.output_requirements}</p>
                  </div>
                )}
              </div>
            </SectionCard>

            <div className="space-y-6">
              <SectionCard title="Capabilities">
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="mb-2 font-medium">Tools</div>
                    <div className="flex flex-wrap gap-1.5">
                      {agent.allowed_tools.length ? (
                        agent.allowed_tools.map((t) => (
                          <ToneBadge key={t} tone="blue">
                            <Wrench className="size-3" /> {t}
                          </ToneBadge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">No tools</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 font-medium">Task kinds</div>
                    <div className="flex flex-wrap gap-1.5">
                      {agent.task_kinds.map((k) => (
                        <ToneBadge key={k}>{humanize(k)}</ToneBadge>
                      ))}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4">
                    {[
                      ["Model", agent.model_override ?? humanize(agent.model_tier)],
                      ["Temperature", agent.temperature],
                      ["Token limit", formatNumber(agent.max_tokens_per_task)],
                      ["Cost limit", formatUsd(agent.max_cost_usd_per_task)],
                      ["Timeout", formatDuration(agent.timeout_seconds)],
                      ["Retries", agent.max_retries],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="truncate font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </SectionCard>

              <SectionCard title="Reporting line" flush>
                <ul className="divide-y text-sm">
                  {manager && (
                    <li>
                      <Link href={`/agents/${manager.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
                        <AgentAvatar name={manager.name} role={manager.role_type} status={manager.stats.status} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{manager.name}</span>
                        <span className="text-xs text-muted-foreground">Manager</span>
                      </Link>
                    </li>
                  )}
                  {reports.map((r) => (
                    <li key={r.id}>
                      <Link href={`/agents/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
                        <AgentAvatar name={r.name} role={r.role_type} status={r.stats.status} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        <span className="text-xs text-muted-foreground">Direct report</span>
                      </Link>
                    </li>
                  ))}
                  {!manager && !reports.length && (
                    <li className="px-5 py-4 text-muted-foreground">No manager or direct reports.</li>
                  )}
                </ul>
              </SectionCard>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="configuration" className="space-y-6 pb-24">
          {conflict && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle />
              <AlertTitle>Someone else saved version {agent.version}</AlertTitle>
              <AlertDescription className="text-amber-900/80">
                <p>
                  You are editing version {baseline.version}. Saving will overwrite their changes.{" "}
                  <button className="font-medium underline" onClick={discard}>
                    Discard my edits and load the latest
                  </button>
                </p>
              </AlertDescription>
            </Alert>
          )}
          <ErrorAlert message={saveError} className="mb-0" />

          <SectionCard title="Role & instructions" description="What the agent is told on every task">
            <div className="grid gap-5">
              <Field label="Description" htmlFor="description">
                {textarea("description", "min-h-16")}
              </Field>
              <Field label="Responsibilities" htmlFor="responsibilities" hint="One per line">
                {textarea("responsibilities", "min-h-24")}
              </Field>
              <Field
                label="System instructions"
                htmlFor="system_instructions"
                error={errors.system_instructions}
                hint={`${form.system_instructions.length.toLocaleString()} characters · combined with the role, company policies and response protocol`}
              >
                {textarea("system_instructions", "min-h-40 font-mono text-xs leading-relaxed")}
              </Field>
              <Field label="Output requirements" htmlFor="output_requirements">
                {textarea("output_requirements", "min-h-16")}
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Capabilities" description="Enforced in code: the agent cannot use anything not allowed here">
            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label>Permitted tools</Label>
                {!tools ? (
                  <Skeleton className="h-20" />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {tools.map((t) => (
                      <Label
                        key={t.name}
                        className="flex items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5"
                      >
                        <Checkbox
                          checked={form.allowed_tools.includes(t.name)}
                          disabled={!canEdit}
                          onCheckedChange={() => toggle("allowed_tools", t.name)}
                        />
                        <span className="grid gap-1">
                          <span className="font-medium">{t.name}</span>
                          <span className="text-xs text-muted-foreground">{t.description}</span>
                        </span>
                      </Label>
                    ))}
                  </div>
                )}
              </div>
              <Field label="Task kinds" error={errors.task_kinds} hint="Work the engine may assign to this agent">
                <div className="flex flex-wrap gap-2">
                  {TASK_KINDS.map((k) => {
                    const on = form.task_kinds.includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        disabled={!canEdit}
                        aria-pressed={on}
                        onClick={() => toggle("task_kinds", k)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50",
                          on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                        )}
                      >
                        {humanize(k)}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Model & limits" description="Per-task budget; work pauses for approval when a limit is reached">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Model tier" htmlFor="model_tier">
                <Select value={form.model_tier} disabled={!canEdit} onValueChange={(v) => set("model_tier", v)}>
                  <SelectTrigger id="model_tier" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIERS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Model override"
                htmlFor="model_override"
                error={errors.model_override}
                hint="Optional: provider/model"
                className="lg:col-span-3"
              >
                <Input
                  id="model_override"
                  value={form.model_override}
                  disabled={!canEdit}
                  placeholder="e.g. ollama/qwen3:14b"
                  aria-invalid={Boolean(errors.model_override)}
                  onChange={(e) => set("model_override", e.target.value)}
                />
              </Field>
              <Field label="Temperature" htmlFor="temperature" error={errors.temperature} hint="0 = focused, 2 = creative">
                {numberInput("temperature", { step: "0.1", min: 0, max: 2 })}
              </Field>
              <Field label="Token limit / task" htmlFor="max_tokens_per_task" error={errors.max_tokens_per_task}>
                {numberInput("max_tokens_per_task", { step: 1000, min: 1000 })}
              </Field>
              <Field label="Cost limit / task (USD)" htmlFor="max_cost_usd_per_task" error={errors.max_cost_usd_per_task}>
                {numberInput("max_cost_usd_per_task", { step: "0.01", min: 0, max: 1000 })}
              </Field>
              <Field label="Timeout (seconds)" htmlFor="timeout_seconds" error={errors.timeout_seconds}>
                {numberInput("timeout_seconds", { min: 10, max: 7200 })}
              </Field>
              <Field label="Max retries" htmlFor="max_retries" error={errors.max_retries}>
                {numberInput("max_retries", { min: 0, max: 10 })}
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Quality & escalation">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Quality criteria" htmlFor="quality_criteria" hint={`${lines(form.quality_criteria).length} criteria · one per line`}>
                {textarea("quality_criteria", "min-h-32")}
              </Field>
              <Field label="Escalation rules" htmlFor="escalation_rules" hint={`${lines(form.escalation_rules).length} rules · one per line`}>
                {textarea("escalation_rules", "min-h-32")}
              </Field>
            </div>
          </SectionCard>

          {canEdit && dirty && (
            <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
              <div className="flex items-center gap-2 text-sm">
                <span className="size-2 rounded-full bg-amber-500" />
                {invalid ? (
                  <span className="text-destructive">
                    Fix {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? "" : "s"} before saving
                  </span>
                ) : (
                  <span>Unsaved changes · saving creates version {agent.version + 1}</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={discard} disabled={saving}>
                  <Undo2 /> Discard
                </Button>
                <Button size="sm" onClick={save} disabled={saving || invalid}>
                  {saving && <Loader2 className="animate-spin" />}
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity">
          <div className="grid gap-6 xl:grid-cols-5">
            <SectionCard title="Assigned tasks" className="min-w-0 xl:col-span-3" flush>
              {tasksError && !tasks ? (
                <PageError message={tasksError} onRetry={reloadTasks} className="border-0 shadow-none ring-0" />
              ) : !tasks ? (
                <div className="space-y-2 p-5">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              ) : !tasks.length ? (
                <EmptyState title="No tasks assigned yet" icon={<ListChecks className="size-5" />} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Task</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead className="pr-5 text-right">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((t) => (
                      <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelectedTask(t.id)}>
                        <TableCell className="max-w-72 pl-5">
                          <div className="truncate font-medium">{t.title}</div>
                          <div className="text-xs text-muted-foreground">{humanize(t.kind)}</div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.attempt_count}/{t.max_attempts}
                        </TableCell>
                        <TableCell className="pr-5 text-right text-muted-foreground">{timeAgo(t.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>

            <SectionCard title="Execution log" className="min-w-0 xl:col-span-2" flush>
              {executionsError && !executions ? (
                <p className="px-5 py-4 text-sm text-destructive">{executionsError}</p>
              ) : !executions ? (
                <div className="p-5">
                  <Skeleton className="h-16" />
                </div>
              ) : !executions.length ? (
                <EmptyState title="No executions yet" icon={<Gauge className="size-5" />} />
              ) : (
                <ul className="max-h-[36rem] divide-y overflow-y-auto">
                  {executions.map((e) => (
                    <li key={e.id} className="px-5 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={e.status} />
                        <span className="text-xs text-muted-foreground">{timeAgo(e.started_at)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Attempt {e.attempt} · {e.llm_calls} LLM / {e.tool_calls} tool calls ·{" "}
                        {formatNumber(e.prompt_tokens + e.completion_tokens)} tokens · {formatUsd(e.cost_usd)}
                        {e.model && ` · ${e.provider}/${e.model}`}
                      </div>
                      {e.error && <div className="mt-1 text-xs break-words text-destructive">{e.error}</div>}
                      <ExecutionLog execution={e} compact />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>

      <TaskDrawer
        taskId={selectedTask}
        agents={agentMap}
        onClose={() => setSelectedTask(null)}
        onChanged={() => void reloadTasks()}
      />
    </>
  );
}
