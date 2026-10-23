"use client";

import { useState } from "react";

import { post } from "@/lib/api";
import { formatDate, formatNumber, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, TaskDetail } from "@/lib/types";

import { ExecutionLog } from "./ExecutionLog";
import { Badge, Button, Drawer, ErrorBanner, JsonBlock, Spinner, StatusBadge, inputClass } from "./ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export function TaskDrawer({
  taskId,
  agents,
  onClose,
  onChanged,
}: {
  taskId: string | null;
  agents: Map<string, Agent>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: task, reload } = useApi<TaskDetail>(taskId ? `/api/tasks/${taskId}` : null, 5000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reassignTo, setReassignTo] = useState("");

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await post(path, body);
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const name = (id: string | null) => (id ? (agents.get(id)?.name ?? "agent") : "system");
  const candidates = task ? [...agents.values()].filter((a) => a.is_active && a.task_kinds.includes(task.kind)) : [];
  const result = (task?.result ?? {}) as Record<string, unknown>;

  return (
    <Drawer open={!!taskId} onClose={onClose} title={task?.title ?? "Task"}>
      {!task || task.id !== taskId ? (
        <Spinner />
      ) : (
        <div className="space-y-6 text-sm">
          <ErrorBanner message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <Badge tone="violet">{humanize(task.kind)}</Badge>
            <span className="text-slate-500">
              {name(task.assigned_agent_id)} · attempt {task.attempt_count}/{task.max_attempts} · {formatNumber(task.tokens_used)} tokens ·{" "}
              {formatUsd(task.cost_usd)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(task.status === "failed" || task.status === "blocked") && (
              <Button size="sm" variant="primary" loading={busy} onClick={() => act(`/api/tasks/${task.id}/retry`)}>
                Retry
              </Button>
            )}
            {!["approved", "failed", "cancelled"].includes(task.status) && (
              <Button size="sm" variant="danger" loading={busy} onClick={() => act(`/api/tasks/${task.id}/cancel`)}>
                Cancel task
              </Button>
            )}
            {["pending", "ready", "blocked", "failed"].includes(task.status) && (
              <span className="flex items-center gap-2">
                <select className={`${inputClass} py-1 text-xs`} value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">Reassign to…</option>
                  {candidates.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" disabled={!reassignTo} loading={busy} onClick={() => act(`/api/tasks/${task.id}/reassign`, { agent_id: reassignTo })}>
                  Reassign
                </Button>
              </span>
            )}
          </div>

          <Section title="Objective">
            <p className="whitespace-pre-wrap text-slate-700">{task.objective}</p>
            {task.acceptance_criteria.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-slate-700">
                {task.acceptance_criteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <div className="text-xs text-slate-500">
              Created {formatDate(task.created_at)} · started {formatDate(task.started_at)} · completed {formatDate(task.completed_at)}
              {task.deadline && ` · deadline ${formatDate(task.deadline)}`}
            </div>
          </Section>

          {task.last_error && (
            <Section title="Last error">
              <div className="rounded-lg bg-rose-50 p-3 text-rose-700">{task.last_error}</div>
            </Section>
          )}

          {task.result && (
            <Section title="Result">
              {typeof result.summary === "string" && <p className="text-slate-700">{result.summary}</p>}
              <JsonBlock value={task.result} />
            </Section>
          )}

          {task.evidence.length > 0 && (
            <Section title="Platform-verified evidence">
              <JsonBlock value={task.evidence} />
            </Section>
          )}

          {task.reviews.length > 0 && (
            <Section title="QA reviews">
              <ul className="space-y-2">
                {task.reviews.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.verdict} />
                      <span className="text-slate-500">
                        attempt {r.attempt} · score {r.score ?? "—"} · {name(r.reviewer_agent_id)}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-700">{r.feedback}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`Executions (${task.executions.length})`}>
            {task.executions.map((e) => (
              <div key={e.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <StatusBadge status={e.status} /> attempt {e.attempt} · {e.llm_calls} LLM / {e.tool_calls} tool calls ·{" "}
                  {formatNumber(e.prompt_tokens + e.completion_tokens)} tokens · {formatUsd(e.cost_usd)}
                  {e.latency_ms !== null && ` · ${(e.latency_ms / 1000).toFixed(1)}s`}
                </div>
                {e.error && <div className="mt-1 text-xs text-rose-600">{e.error}</div>}
                <ExecutionLog execution={e} compact />
              </div>
            ))}
          </Section>

          <Section title={`Agent messages (${task.messages.length})`}>
            <ul className="space-y-2">
              {task.messages.map((m) => (
                <li key={m.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                  <div className="font-medium text-slate-700">
                    {humanize(m.message_type)}: {name(m.sender_agent_id)} → {name(m.recipient_agent_id)}
                  </div>
                  <div className="mt-1 text-slate-500">{formatDate(m.created_at)}</div>
                  <JsonBlock value={m.payload} />
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </Drawer>
  );
}
