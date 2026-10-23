"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { TaskDrawer } from "@/components/TaskDrawer";
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { formatDate, formatDuration, formatNumber, formatPercent, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, DepartmentDashboard } from "@/lib/types";

export default function DepartmentPage() {
  const { key } = useParams<{ key: string }>();
  const { data, error, reload } = useApi<DepartmentDashboard>(`/api/dashboard/departments/${key}`, 10000);
  const { data: agents } = useApi<Agent[]>("/api/agents");
  const [selected, setSelected] = useState<string | null>(null);
  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const m = data.metrics;
  return (
    <>
      <PageHeader
        title={data.department.name}
        subtitle={data.department.description}
        actions={<Link href="/departments" className="text-sm text-brand-700 hover:underline">← All departments</Link>}
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Tasks completed" value={m.tasks_completed} tone="green" />
        <Stat label="Failed" value={m.tasks_failed} tone={m.tasks_failed ? "red" : "slate"} />
        <Stat label="First-pass QA" value={formatPercent(m.first_pass_acceptance_rate)} />
        <Stat label="Avg completion" value={formatDuration(m.mean_task_completion_seconds)} />
        <Stat label="Cost" value={formatUsd(m.total_cost_usd)} hint={`${formatNumber(m.token_consumption)} tokens`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title={`Team (${data.team.length})`} padded={false} className="lg:col-span-1">
          <ul className="divide-y divide-slate-100">
            {data.team.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/agents/${a.id}`} className="truncate font-medium text-slate-800 hover:text-brand-700">
                    {a.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {humanize(a.role_type)} · {a.stats.succeeded} done
                    {a.stats.queued_tasks > 0 && ` · ${a.stats.queued_tasks} queued`}
                  </div>
                </div>
                <StatusBadge status={a.stats.status} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Workload">
            {Object.keys(data.workload).length === 0 ? (
              <EmptyState title="No work assigned yet" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.workload).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <StatusBadge status={status} />
                    <span className="text-sm font-semibold tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Task queue" padded={false}>
            {!data.queue.length ? (
              <EmptyState title="Queue is empty" />
            ) : (
              <Table head={["Task", "Agent", "Status", "Priority", "Attempts"]}>
                {data.queue.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(t.id)}>
                    <Td>
                      <div className="font-medium text-slate-800">{t.title}</div>
                      <div className="text-xs text-slate-500">{humanize(t.kind)}</div>
                    </Td>
                    <Td>{t.assigned_agent_id ? agentMap.get(t.assigned_agent_id)?.name : "—"}</Td>
                    <Td>
                      <StatusBadge status={t.status} />
                    </Td>
                    <Td>P{t.priority}</Td>
                    <Td>
                      {t.attempt_count}/{t.max_attempts}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card title="Department reports" padded={false}>
            {!data.reports.length ? (
              <EmptyState title="No reports yet" hint="Consolidated reports appear when work packages are completed." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.reports.map((r) => (
                  <li key={r.task_id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/projects/${r.project_id}`} className="font-medium text-slate-800 hover:text-brand-700">
                        {r.title}
                      </Link>
                      {r.status && <Badge tone={r.status === "complete" ? "green" : "amber"}>{r.status}</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.project_title} · {formatDate(r.completed_at)}
                    </div>
                    {r.summary && <p className="mt-1 text-slate-600">{r.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={() => void reload()} />
    </>
  );
}
