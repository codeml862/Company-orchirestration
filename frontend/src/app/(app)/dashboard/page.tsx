"use client";

import { AlertTriangle, Bot, CheckCircle2, Clock, DollarSign, FolderKanban, Smile, XCircle } from "lucide-react";
import Link from "next/link";

import { Badge, Bar, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Stat, StatusBadge } from "@/components/ui";
import { formatDuration, formatNumber, formatPercent, formatUsd, humanize, timeAgo } from "@/lib/format";
import { useApi, useLiveEvents } from "@/lib/hooks";
import type { ExecutiveDashboard } from "@/lib/types";

export default function DashboardPage() {
  const { data, error, reload } = useApi<ExecutiveDashboard>("/api/dashboard/executive", 15000);
  // Refresh the numbers whenever something meaningful happens.
  useLiveEvents({
    max: 1,
    onEvent: (e) => {
      if (e.action.startsWith("task.") || e.action.startsWith("project.") || e.action.startsWith("approval.")) void reload();
    },
  });

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const q = data.quality;
  const approvalsTotal = Object.values(data.pending_approvals).reduce((a, b) => a + b, 0);
  const maxDept = Math.max(1, ...data.departments.map((d) => d.tasks_completed + d.tasks_failed + d.running_tasks));

  return (
    <>
      <PageHeader title="Executive Dashboard" subtitle="Company-wide performance, computed from recorded executions." />
      {data.llm_providers_configured === 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">No LLM provider configured</div>
            Agents will not start work until a provider is set in <code>AICO_LLM_PROVIDERS</code>. Projects and tasks stay
            queued; nothing is lost.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Active projects" value={data.projects.active} icon={<FolderKanban className="h-4 w-4" />} />
        <Stat
          label="AI agents"
          value={`${data.agents.working} / ${data.agents.active}`}
          hint={`working now · ${data.agents.total} total`}
          tone="violet"
          icon={<Bot className="h-4 w-4" />}
        />
        <Stat label="Tasks completed" value={formatNumber(data.tasks.completed)} tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Tasks failed" value={formatNumber(data.tasks.failed)} tone={data.tasks.failed ? "red" : "slate"} icon={<XCircle className="h-4 w-4" />} />
        <Stat
          label="Avg completion time"
          value={formatDuration(q.mean_task_completion_seconds)}
          hint="specialist tasks, claim to approval"
          icon={<Clock className="h-4 w-4" />}
        />
        <Stat
          label="AI operating cost"
          value={formatUsd(q.total_cost_usd)}
          hint={`${formatUsd(data.cost.last_30_days_usd)} last 30 days`}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <Stat
          label="Client satisfaction"
          value={data.client_satisfaction.average !== null ? `${data.client_satisfaction.average} / 5` : "—"}
          hint={`${data.client_satisfaction.responses} response(s)`}
          tone="blue"
          icon={<Smile className="h-4 w-4" />}
        />
        <Stat
          label="Pending approvals"
          value={approvalsTotal}
          tone={approvalsTotal ? "amber" : "slate"}
          hint={<Link href="/supervisor" className="text-brand-600 hover:underline">Open supervisor console</Link>}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Quality & performance" className="lg:col-span-1">
          <dl className="space-y-3 text-sm">
            {[
              ["Task success rate", formatPercent(q.task_success_rate)],
              ["First-pass acceptance", formatPercent(q.first_pass_acceptance_rate)],
              ["Rework rate", formatPercent(q.rework_rate)],
              ["Error rate (executions)", formatPercent(q.error_rate)],
              ["Human intervention rate", formatPercent(q.human_intervention_rate)],
              ["SLA compliance", formatPercent(q.sla_compliance)],
              ["Cost per completed task", formatUsd(q.cost_per_completed_task_usd)],
              ["Tokens consumed", formatNumber(q.token_consumption)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between">
                <dt className="text-slate-500">{label}</dt>
                <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Department performance" className="lg:col-span-2" padded={false}>
          <div className="divide-y divide-slate-100">
            {data.departments.map((d) => (
              <Link key={d.key} href={`/departments/${d.key}`} className="grid grid-cols-12 items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <div className="col-span-4 text-sm font-medium text-slate-800">{d.name}</div>
                <div className="col-span-4">
                  <Bar value={d.tasks_completed} max={maxDept} tone="bg-emerald-500" />
                </div>
                <div className="col-span-4 flex justify-end gap-2 text-xs text-slate-500">
                  <span>{d.tasks_completed} done</span>
                  {d.tasks_failed > 0 && <Badge tone="red">{d.tasks_failed} failed</Badge>}
                  {d.running_tasks > 0 && <Badge tone="violet">{d.running_tasks} running</Badge>}
                  <span>{formatPercent(d.first_pass_acceptance_rate)} 1st pass</span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Projects by status">
          {Object.keys(data.projects.by_status).length === 0 ? (
            <EmptyState title="No projects yet" hint="Projects submitted by clients appear here." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.projects.by_status).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <StatusBadge status={status} />
                  <span className="text-sm font-semibold tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">Tasks by status</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(data.tasks.by_status).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <StatusBadge status={status} />
                <span className="text-sm font-semibold tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Alerts & escalations" padded={false}>
          {data.alerts.length === 0 ? (
            <EmptyState title="No alerts" hint="Warnings, failures and escalations appear here." />
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <StatusBadge status={a.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-800">{a.message}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {timeAgo(a.created_at)}
                      {a.project_id && (
                        <>
                          {" · "}
                          <Link className="text-brand-600 hover:underline" href={`/projects/${a.project_id}`}>
                            project
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {Object.keys(data.pending_approvals).length > 0 && (
        <div className="mt-6 text-xs text-slate-500">
          Pending:{" "}
          {Object.entries(data.pending_approvals)
            .map(([k, v]) => `${v} ${humanize(k).toLowerCase()}`)
            .join(", ")}
        </div>
      )}
    </>
  );
}
