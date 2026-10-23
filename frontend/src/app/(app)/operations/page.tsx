"use client";

import { Radio } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { TaskDrawer } from "@/components/TaskDrawer";
import { Timeline } from "@/components/Timeline";
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge, cn } from "@/components/ui";
import { humanize, timeAgo } from "@/lib/format";
import { useApi, useLiveEvents } from "@/lib/hooks";
import type { Agent, Approval, Task } from "@/lib/types";

const FILTERS = {
  all: () => true,
  decisions: (action: string) => action.startsWith("task.created") || action === "task.approved" || action.startsWith("approval."),
  problems: (_: string, severity: string) => severity !== "info",
  retries: (action: string) => action === "task.ready",
} as const;

export default function OperationsPage() {
  const { data: active, reload: reloadActive } = useApi<Task[]>(
    "/api/tasks?status=running&status=in_review&status=ready&status=awaiting_approval&status=blocked&limit=200",
    10000,
  );
  const { data: agents, reload: reloadAgents } = useApi<Agent[]>("/api/agents", 15000);
  const { data: approvals } = useApi<Approval[]>("/api/approvals", 10000);
  const [filter, setFilter] = useState<keyof typeof FILTERS>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const { events, connected } = useLiveEvents({
    max: 300,
    onEvent: (e) => {
      if (e.entity_type === "task") void reloadActive();
      if (e.action === "execution.started" || e.action === "task.approved") void reloadAgents();
    },
  });

  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const byStatus = (s: string) => (active ?? []).filter((t) => t.status === s);
  const working = (agents ?? []).filter((a) => a.stats.status === "working");
  const shown = events.filter((e) => FILTERS[filter](e.action, e.severity));

  return (
    <>
      <PageHeader
        title="Live Operations Center"
        subtitle="Every task transition, coordinator decision, retry, approval and error as it happens."
        actions={
          <Badge tone={connected ? "green" : "red"}>
            <Radio className="h-3 w-3" /> {connected ? "Live" : "Reconnecting…"}
          </Badge>
        }
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Running" value={byStatus("running").length} tone="violet" />
        <Stat label="Queued" value={byStatus("ready").length} tone="blue" />
        <Stat label="In QA review" value={byStatus("in_review").length} tone="amber" />
        <Stat label="Awaiting approval" value={approvals?.length ?? 0} tone="amber" />
        <Stat label="Blocked" value={byStatus("blocked").length} tone={byStatus("blocked").length ? "red" : "slate"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Activity timeline"
          className="lg:col-span-2"
          actions={
            <div className="flex gap-1">
              {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium",
                    filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {humanize(f)}
                </button>
              ))}
            </div>
          }
        >
          <div className="max-h-[40rem] overflow-y-auto">
            <Timeline events={shown} showProjectLinks onTaskClick={setSelected} />
          </div>
        </Card>
        <div className="space-y-6">
          <Card title={`Agents working (${working.length})`} padded={false}>
            {!working.length ? (
              <EmptyState title="All agents idle" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {working.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <Link href={`/agents/${a.id}`} className="text-slate-800 hover:text-brand-700">
                      {a.name}
                    </Link>
                    <StatusBadge status="working" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Active tasks" padded={false}>
            {!active?.length ? (
              <EmptyState title="No active tasks" />
            ) : (
              <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
                {active.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => setSelected(t.id)} className="w-full px-4 py-2 text-left hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-slate-800">{t.title}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="text-xs text-slate-500">
                        {t.assigned_agent_id ? agentMap.get(t.assigned_agent_id)?.name : "unassigned"} · attempt {t.attempt_count}/
                        {t.max_attempts} · {timeAgo(t.started_at ?? t.created_at)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={() => void reloadActive()} />
    </>
  );
}
