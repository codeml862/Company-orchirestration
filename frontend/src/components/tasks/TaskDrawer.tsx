"use client";

import { RotateCcw, Square, UserRoundCog } from "lucide-react";
import { useState } from "react";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { JsonBlock } from "@/components/shared/JsonBlock";
import { Loading } from "@/components/shared/Loading";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { post } from "@/lib/api";
import { formatDate, formatNumber, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, TaskDetail } from "@/lib/types";

import { ExecutionLog } from "./ExecutionLog";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
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
  const loaded = task && task.id === taskId;
  const candidates = loaded ? [...agents.values()].filter((a) => a.is_active && a.task_kinds.includes(task.kind)) : [];
  const result = (task?.result ?? {}) as Record<string, unknown>;

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{loaded ? task.title : "Task"}</SheetTitle>
          <SheetDescription>
            {loaded
              ? `${name(task.assigned_agent_id)} · attempt ${task.attempt_count}/${task.max_attempts} · ${formatNumber(task.tokens_used)} tokens · ${formatUsd(task.cost_usd)}`
              : "Loading task details"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5">
          {!loaded ? (
            <Loading />
          ) : (
            <div className="space-y-6 text-sm">
              <ErrorAlert message={error} />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={task.status} />
                <ToneBadge tone="violet">{humanize(task.kind)}</ToneBadge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(task.status === "failed" || task.status === "blocked") && (
                  <Button size="sm" disabled={busy} onClick={() => act(`/api/tasks/${task.id}/retry`)}>
                    <RotateCcw /> Retry
                  </Button>
                )}
                {!["approved", "failed", "cancelled"].includes(task.status) && (
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => act(`/api/tasks/${task.id}/cancel`)}>
                    <Square /> Cancel task
                  </Button>
                )}
                {["pending", "ready", "blocked", "failed"].includes(task.status) && (
                  <div className="flex items-center gap-2">
                    <Select value={reassignTo} onValueChange={setReassignTo}>
                      <SelectTrigger size="sm" className="w-56">
                        <SelectValue placeholder="Reassign to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!reassignTo || busy}
                      onClick={() => act(`/api/tasks/${task.id}/reassign`, { agent_id: reassignTo })}
                    >
                      <UserRoundCog /> Reassign
                    </Button>
                  </div>
                )}
              </div>

              <Section title="Objective">
                <p className="whitespace-pre-wrap">{task.objective}</p>
                {task.acceptance_criteria.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5">
                    {task.acceptance_criteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                <div className="text-xs text-muted-foreground">
                  Created {formatDate(task.created_at)} · started {formatDate(task.started_at)} · completed{" "}
                  {formatDate(task.completed_at)}
                  {task.deadline && ` · deadline ${formatDate(task.deadline)}`}
                </div>
              </Section>

              {task.last_error && (
                <Section title="Last error">
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700">{task.last_error}</div>
                </Section>
              )}

              {task.result && (
                <Section title="Result">
                  {typeof result.summary === "string" && <p>{result.summary}</p>}
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
                      <li key={r.id} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={r.verdict} />
                          <span className="text-muted-foreground">
                            attempt {r.attempt} · score {r.score ?? "—"} · {name(r.reviewer_agent_id)}
                          </span>
                        </div>
                        <p className="mt-1">{r.feedback}</p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title={`Executions (${task.executions.length})`}>
                {task.executions.map((e) => (
                  <div key={e.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                    <li key={m.id} className="rounded-lg bg-muted/60 p-3 text-xs">
                      <div className="font-medium">
                        {humanize(m.message_type)}: {name(m.sender_agent_id)} → {name(m.recipient_agent_id)}
                      </div>
                      <div className="mt-1 mb-2 text-muted-foreground">{formatDate(m.created_at)}</div>
                      <JsonBlock value={m.payload} />
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
