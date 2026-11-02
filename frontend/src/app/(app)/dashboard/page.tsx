"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FolderKanban,
  Info,
  OctagonAlert,
  Plus,
  ShieldCheck,
  Smile,
} from "lucide-react";
import Link from "next/link";

import { DepartmentIcon } from "@/components/shared/DepartmentIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { ToneBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type Tone, formatDuration, formatNumber, formatPercent, formatUsd, humanize, statusTone, timeAgo } from "@/lib/format";
import { useApi, useLiveEvents } from "@/lib/hooks";
import type { ExecutiveDashboard } from "@/lib/types";
import { cn } from "@/lib/utils";

const BAR: Record<Tone, string> = {
  gray: "bg-slate-300",
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-rose-500",
  violet: "bg-violet-500",
};

/** One stacked bar of counts by status, with a legend. */
function StatusBreakdown({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {entries.map(([status, n]) => (
          <div
            key={status}
            className={BAR[statusTone(status)]}
            style={{ width: `${(n / total) * 100}%` }}
            title={`${humanize(status)}: ${n}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([status, n]) => (
          <span key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", BAR[statusTone(status)])} />
            {humanize(status)} <span className="font-medium text-foreground tabular-nums">{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, rate, good = "high" }: { label: string; value: string; rate?: number | null; good?: "high" | "low" }) {
  const healthy = rate == null ? null : good === "high" ? rate >= 0.8 : rate <= 0.2;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium tabular-nums", healthy === false && "text-amber-700")}>{value}</span>
      </div>
      {rate !== undefined && <ProgressBar value={rate ?? 0} max={1} tone={healthy === false ? "primary" : "green"} className="h-1.5" />}
    </div>
  );
}

const SEVERITY = {
  error: { icon: OctagonAlert, className: "text-rose-600 bg-rose-50" },
  warning: { icon: AlertTriangle, className: "text-amber-600 bg-amber-50" },
  info: { icon: Info, className: "text-sky-600 bg-sky-50" },
};

export default function DashboardPage() {
  const { data, error, errorStatus, refreshing, updatedAt, reload } = useApi<ExecutiveDashboard>(
    "/api/dashboard/executive",
    15000,
  );
  // Refresh the numbers whenever something meaningful happens.
  useLiveEvents({
    max: 1,
    onEvent: (e) => {
      if (e.action.startsWith("task.") || e.action.startsWith("project.") || e.action.startsWith("approval.")) void reload();
    },
  });

  const header = (
    <PageHeader
      title="Executive Dashboard"
      subtitle="Company-wide performance, computed from recorded executions."
      actions={
        <>
          <SyncStatus updatedAt={updatedAt} refreshing={refreshing} error={data ? error : null} onRefresh={reload} />
          <Button size="sm" asChild>
            <Link href="/projects/new">
              <Plus /> New project
            </Link>
          </Button>
        </>
      }
    />
  );

  if (!data) {
    return (
      <>
        {header}
        {error ? (
          <PageError message={error} status={errorStatus} onRetry={reload} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-80 rounded-xl" />
          </div>
        )}
      </>
    );
  }

  const q = data.quality;
  const approvalsTotal = Object.values(data.pending_approvals).reduce((a, b) => a + b, 0);

  return (
    <>
      {header}
      {data.llm_providers_configured === 0 && (
        <Alert className="mb-6 border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle />
          <AlertTitle>No LLM provider configured</AlertTitle>
          <AlertDescription className="text-amber-900/80">
            <p>
              Agents will not start work until a provider is set in <code>AICO_LLM_PROVIDERS</code> (backend/.env).
              Projects and tasks stay queued; nothing is lost.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Active projects"
          value={data.projects.active}
          hint={`${data.projects.by_status.completed ?? 0} completed all time`}
          tone="blue"
          icon={<FolderKanban />}
        />
        <StatCard
          label="Agents working"
          value={`${data.agents.working} / ${data.agents.active}`}
          hint={`${data.agents.total} agents in the company`}
          tone="violet"
          icon={<Bot />}
        />
        <StatCard
          label="Tasks completed"
          value={formatNumber(data.tasks.completed)}
          hint={data.tasks.failed ? `${formatNumber(data.tasks.failed)} failed` : "none failed"}
          tone={data.tasks.failed ? "red" : "green"}
          icon={<CheckCircle2 />}
        />
        <StatCard
          label="Pending approvals"
          value={approvalsTotal}
          tone={approvalsTotal ? "amber" : "slate"}
          hint={
            <Link href="/supervisor" className="text-primary hover:underline">
              {approvalsTotal ? "Review in supervisor console" : "Open supervisor console"}
            </Link>
          }
          icon={<ShieldCheck />}
        />
        <StatCard
          label="Avg completion time"
          value={formatDuration(q.mean_task_completion_seconds)}
          hint="specialist tasks, claim to approval"
          icon={<Clock />}
        />
        <StatCard
          label="AI operating cost"
          value={formatUsd(q.total_cost_usd)}
          hint={`${formatUsd(data.cost.last_30_days_usd)} in the last 30 days`}
          tone="green"
          icon={<DollarSign />}
        />
        <StatCard
          label="Client satisfaction"
          value={data.client_satisfaction.average !== null ? `${data.client_satisfaction.average} / 5` : "—"}
          hint={`${data.client_satisfaction.responses} response(s)`}
          tone="blue"
          icon={<Smile />}
        />
        <StatCard
          label="Cost per completed task"
          value={formatUsd(q.cost_per_completed_task_usd)}
          hint={`${formatNumber(q.token_consumption)} tokens consumed`}
          icon={<DollarSign />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <SectionCard title="Quality & performance" description="Specialist work, all departments">
          <div className="space-y-4">
            <Metric label="Task success rate" value={formatPercent(q.task_success_rate)} rate={q.task_success_rate} />
            <Metric
              label="First-pass QA acceptance"
              value={formatPercent(q.first_pass_acceptance_rate)}
              rate={q.first_pass_acceptance_rate}
            />
            <Metric label="SLA compliance" value={formatPercent(q.sla_compliance)} rate={q.sla_compliance} />
            <Metric label="Rework rate" value={formatPercent(q.rework_rate)} rate={q.rework_rate} good="low" />
            <Metric label="Execution error rate" value={formatPercent(q.error_rate)} rate={q.error_rate} good="low" />
            <Metric
              label="Human intervention rate"
              value={formatPercent(q.human_intervention_rate)}
              rate={q.human_intervention_rate}
              good="low"
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Department performance"
          className="lg:col-span-2"
          flush
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/departments">
                All departments <ChevronRight />
              </Link>
            </Button>
          }
        >
          <div className="hidden grid-cols-12 gap-3 border-b px-5 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span className="col-span-5">Department</span>
            <span className="col-span-2 text-right">Done</span>
            <span className="col-span-3">First-pass QA</span>
            <span className="col-span-2 text-right">Cost</span>
          </div>
          <div className="divide-y">
            {data.departments.map((d) => (
              <Link
                key={d.key}
                href={`/departments/${d.key}`}
                className="grid grid-cols-12 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/50"
              >
                <div className="col-span-12 flex min-w-0 items-center gap-3 sm:col-span-5">
                  <DepartmentIcon department={d.key} className="size-8 rounded-lg [&_svg]:size-4" />
                  <span className="truncate text-sm font-medium">{d.name}</span>
                  {d.running_tasks > 0 && <ToneBadge tone="violet">{d.running_tasks} running</ToneBadge>}
                </div>
                <div className="col-span-4 text-sm tabular-nums sm:col-span-2 sm:text-right">
                  {d.tasks_completed}
                  {d.tasks_failed > 0 && <span className="text-xs text-rose-600"> / {d.tasks_failed} failed</span>}
                </div>
                <div className="col-span-5 flex items-center gap-2 sm:col-span-3">
                  <ProgressBar value={d.first_pass_acceptance_rate ?? 0} max={1} tone="green" className="h-1.5 flex-1" />
                  <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                    {formatPercent(d.first_pass_acceptance_rate)}
                  </span>
                </div>
                <div className="col-span-3 text-right text-sm tabular-nums text-muted-foreground sm:col-span-2">
                  {formatUsd(d.total_cost_usd)}
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Pipeline">
          <div className="space-y-6">
            <div>
              <div className="mb-2 text-sm font-medium">Projects by status</div>
              <StatusBreakdown counts={data.projects.by_status} empty="No projects yet. Submitted projects appear here." />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">Tasks by status</div>
              <StatusBreakdown counts={data.tasks.by_status} empty="No tasks yet. The CEO agent creates them from projects." />
            </div>
            {approvalsTotal > 0 && (
              <div>
                <div className="mb-2 text-sm font-medium">Waiting for a human</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.pending_approvals).map(([kind, n]) => (
                    <ToneBadge key={kind} tone="amber">
                      {n} {humanize(kind).toLowerCase()}
                    </ToneBadge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Alerts & escalations" flush>
          {data.alerts.length === 0 ? (
            <EmptyState
              title="All clear"
              hint="Warnings, failures and escalations appear here."
              icon={<CheckCircle2 className="size-5" />}
            />
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto">
              {data.alerts.map((a) => {
                const { icon: Icon, className } = SEVERITY[a.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
                return (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", className)}>
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words">{a.message}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {timeAgo(a.created_at)}
                        {a.project_id && (
                          <>
                            {" · "}
                            <Link className="text-primary hover:underline" href={`/projects/${a.project_id}`}>
                              Open project
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}
