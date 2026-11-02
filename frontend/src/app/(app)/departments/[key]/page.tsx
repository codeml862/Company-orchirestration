"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Loading } from "@/components/shared/Loading";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDuration, formatNumber, formatPercent, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, DepartmentDashboard } from "@/lib/types";

export default function DepartmentPage() {
  const { key } = useParams<{ key: string }>();
  const { data, error, reload } = useApi<DepartmentDashboard>(`/api/dashboard/departments/${key}`, 10000);
  const { data: agents } = useApi<Agent[]>("/api/agents");
  const [selected, setSelected] = useState<string | null>(null);
  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);

  if (!data) return error ? <ErrorAlert message={error} /> : <Loading />;
  const m = data.metrics;
  return (
    <>
      <PageHeader
        title={data.department.name}
        subtitle={data.department.description}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/departments">
              <ArrowLeft /> All departments
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Tasks completed" value={m.tasks_completed} tone="green" />
        <StatCard label="Failed" value={m.tasks_failed} tone={m.tasks_failed ? "red" : "slate"} />
        <StatCard label="First-pass QA" value={formatPercent(m.first_pass_acceptance_rate)} />
        <StatCard label="Avg completion" value={formatDuration(m.mean_task_completion_seconds)} />
        <StatCard label="Cost" value={formatUsd(m.total_cost_usd)} hint={`${formatNumber(m.token_consumption)} tokens`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <SectionCard title={`Team (${data.team.length})`} flush>
          <ul className="divide-y">
            {data.team.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/agents/${a.id}`} className="truncate font-medium hover:text-primary">
                    {a.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {humanize(a.role_type)} · {a.stats.succeeded} done
                    {a.stats.queued_tasks > 0 && ` · ${a.stats.queued_tasks} queued`}
                  </div>
                </div>
                <StatusBadge status={a.stats.status} />
              </li>
            ))}
          </ul>
        </SectionCard>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          <SectionCard title="Workload">
            {Object.keys(data.workload).length === 0 ? (
              <EmptyState title="No work assigned yet" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.workload).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <StatusBadge status={status} />
                    <span className="text-sm font-semibold tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
          <SectionCard title="Task queue" flush>
            {!data.queue.length ? (
              <EmptyState title="Queue is empty" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Task</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="pr-5">Attempts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.queue.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t.id)}>
                      <TableCell className="pl-5">
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground">{humanize(t.kind)}</div>
                      </TableCell>
                      <TableCell>{t.assigned_agent_id ? agentMap.get(t.assigned_agent_id)?.name : "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={t.status} />
                      </TableCell>
                      <TableCell>P{t.priority}</TableCell>
                      <TableCell className="pr-5 tabular-nums">
                        {t.attempt_count}/{t.max_attempts}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
          <SectionCard title="Department reports" flush>
            {!data.reports.length ? (
              <EmptyState title="No reports yet" hint="Consolidated reports appear when work packages are completed." />
            ) : (
              <ul className="divide-y">
                {data.reports.map((r) => (
                  <li key={r.task_id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/projects/${r.project_id}`} className="font-medium hover:text-primary">
                        {r.title}
                      </Link>
                      {r.status && <ToneBadge tone={r.status === "complete" ? "green" : "amber"}>{r.status}</ToneBadge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.project_title} · {formatDate(r.completed_at)}
                    </div>
                    {r.summary && <p className="mt-1 text-muted-foreground">{r.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={() => void reload()} />
    </>
  );
}
