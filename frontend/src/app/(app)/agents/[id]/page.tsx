"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ExecutionLog } from "@/components/ExecutionLog";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Spinner,
  Stat,
  StatusBadge,
  inputClass,
} from "@/components/ui";
import { patch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDuration, formatNumber, formatUsd, humanize, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Execution } from "@/lib/types";

const TASK_KINDS = ["analyze", "plan", "allocate", "execute", "review", "consolidate", "final_report"];

type Form = {
  system_instructions: string;
  output_requirements: string;
  allowed_tools: string[];
  task_kinds: string[];
  model_tier: string;
  model_override: string;
  temperature: number;
  max_retries: number;
  timeout_seconds: number;
  max_tokens_per_task: number;
  max_cost_usd_per_task: string;
  quality_criteria: string;
  escalation_rules: string;
  is_active: boolean;
};

function toForm(a: Agent): Form {
  return {
    system_instructions: a.system_instructions,
    output_requirements: a.output_requirements,
    allowed_tools: a.allowed_tools,
    task_kinds: a.task_kinds,
    model_tier: a.model_tier,
    model_override: a.model_override ?? "",
    temperature: a.temperature,
    max_retries: a.max_retries,
    timeout_seconds: a.timeout_seconds,
    max_tokens_per_task: a.max_tokens_per_task,
    max_cost_usd_per_task: String(a.max_cost_usd_per_task),
    quality_criteria: a.quality_criteria.join("\n"),
    escalation_rules: a.escalation_rules.join("\n"),
    is_active: a.is_active,
  };
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: agent, error, setData } = useApi<Agent>(`/api/agents/${id}`, 15000);
  const { data: tools } = useApi<{ name: string; description: string }[]>("/api/tools");
  const { data: executions } = useApi<Execution[]>(`/api/agents/${id}/executions?limit=30`, 15000);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (agent && !form) setForm(toForm(agent));
  }, [agent, form]);

  if (!agent || !form) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const canEdit = user?.role !== "client";
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const toggle = (key: "allowed_tools" | "task_kinds", value: string) =>
    set(key, form[key].includes(value) ? form[key].filter((v) => v !== value) : [...form[key], value]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      const updated = await patch<Agent>(`/api/agents/${id}`, {
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
        max_cost_usd_per_task: form.max_cost_usd_per_task,
        quality_criteria: lines(form.quality_criteria),
        escalation_rules: lines(form.escalation_rules),
        is_active: form.is_active,
      });
      setData(updated);
      setForm(toForm(updated));
      setMessage(`Saved as version ${updated.version}.`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const s = agent.stats;
  return (
    <>
      <PageHeader
        title={agent.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} /> {humanize(agent.role_type)} · key <code>{agent.key}</code> · v{agent.version}
            {agent.customized && <Badge tone="amber">customized</Badge>}
          </span>
        }
        actions={<Link href="/agents" className="text-sm text-brand-700 hover:underline">← All agents</Link>}
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Running / queued" value={`${s.running_tasks} / ${s.queued_tasks}`} tone="violet" />
        <Stat label="Executions" value={`${s.succeeded}/${s.executions}`} hint={`${s.failed} failed`} />
        <Stat label="QA first pass" value={s.reviews ? `${s.first_pass_approvals}/${s.reviews}` : "—"} tone="green" />
        <Stat label="Tokens" value={formatNumber(s.tokens)} hint={formatUsd(s.cost_usd)} />
        <Stat label="Avg latency" value={formatDuration(s.avg_latency_ms !== null ? s.avg_latency_ms / 1000 : null)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card title="Configuration" className="lg:col-span-3">
          <ErrorBanner message={saveError} />
          {message && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{agent.description}</p>
            <Field label="System instructions" hint="Combined with the role, responsibilities, company policies and response protocol.">
              <textarea className={`${inputClass} h-36 font-mono text-xs`} value={form.system_instructions} disabled={!canEdit}
                onChange={(e) => set("system_instructions", e.target.value)} />
            </Field>
            <Field label="Output requirements">
              <textarea className={`${inputClass} h-16`} value={form.output_requirements} disabled={!canEdit}
                onChange={(e) => set("output_requirements", e.target.value)} />
            </Field>
            <div>
              <div className="text-sm font-medium text-slate-700">Permitted tools</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {tools?.map((t) => (
                  <label key={t.name} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={form.allowed_tools.includes(t.name)} disabled={!canEdit}
                      onChange={() => toggle("allowed_tools", t.name)} />
                    <span>
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-slate-500">{t.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-700">Task kinds</div>
              <div className="mt-2 flex flex-wrap gap-3">
                {TASK_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.task_kinds.includes(k)} disabled={!canEdit} onChange={() => toggle("task_kinds", k)} />
                    {humanize(k)}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Model tier">
                <select className={inputClass} value={form.model_tier} disabled={!canEdit} onChange={(e) => set("model_tier", e.target.value)}>
                  {["fast", "standard", "strong"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Model override" hint="provider/model, optional">
                <input className={inputClass} value={form.model_override} disabled={!canEdit} onChange={(e) => set("model_override", e.target.value)} />
              </Field>
              <Field label="Temperature">
                <input className={inputClass} type="number" step="0.1" min={0} max={2} value={form.temperature} disabled={!canEdit}
                  onChange={(e) => set("temperature", Number(e.target.value))} />
              </Field>
              <Field label="Max retries">
                <input className={inputClass} type="number" min={0} max={10} value={form.max_retries} disabled={!canEdit}
                  onChange={(e) => set("max_retries", Number(e.target.value))} />
              </Field>
              <Field label="Timeout (s)">
                <input className={inputClass} type="number" min={10} value={form.timeout_seconds} disabled={!canEdit}
                  onChange={(e) => set("timeout_seconds", Number(e.target.value))} />
              </Field>
              <Field label="Max tokens / task">
                <input className={inputClass} type="number" min={1000} value={form.max_tokens_per_task} disabled={!canEdit}
                  onChange={(e) => set("max_tokens_per_task", Number(e.target.value))} />
              </Field>
              <Field label="Max cost / task (USD)">
                <input className={inputClass} value={form.max_cost_usd_per_task} disabled={!canEdit}
                  onChange={(e) => set("max_cost_usd_per_task", e.target.value)} />
              </Field>
            </div>
            <Field label="Quality criteria" hint="One per line">
              <textarea className={`${inputClass} h-24`} value={form.quality_criteria} disabled={!canEdit}
                onChange={(e) => set("quality_criteria", e.target.value)} />
            </Field>
            <Field label="Escalation rules" hint="One per line">
              <textarea className={`${inputClass} h-24`} value={form.escalation_rules} disabled={!canEdit}
                onChange={(e) => set("escalation_rules", e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} disabled={!canEdit || agent.role_type === "ceo"}
                onChange={(e) => set("is_active", e.target.checked)} />
              Active (inactive agents receive no new work)
            </label>
            {canEdit && (
              <Button variant="primary" loading={saving} onClick={save}>
                Save configuration
              </Button>
            )}
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Role">
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-medium text-slate-800">Responsibilities</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
                  {agent.responsibilities.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-medium text-slate-800">Required inputs</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
                  {agent.required_inputs.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
          <Card title="Execution log" padded={false}>
            {!executions?.length ? (
              <EmptyState title="No executions yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {executions.map((e) => (
                  <li key={e.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={e.status} />
                      <span className="text-xs text-slate-500">{timeAgo(e.started_at)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      attempt {e.attempt} · {e.llm_calls} LLM / {e.tool_calls} tool calls ·{" "}
                      {formatNumber(e.prompt_tokens + e.completion_tokens)} tokens · {formatUsd(e.cost_usd)}
                      {e.model && ` · ${e.provider}/${e.model}`}
                    </div>
                    {e.error && <div className="mt-1 text-xs text-rose-600">{e.error}</div>}
                    <ExecutionLog execution={e} compact />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
