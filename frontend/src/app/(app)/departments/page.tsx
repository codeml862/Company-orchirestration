"use client";

import { Activity, Bot, ChevronRight, DollarSign, ListTodo } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { DepartmentIcon } from "@/components/shared/DepartmentIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { SearchInput, matches } from "@/components/shared/SearchInput";
import { StatCard } from "@/components/shared/StatCard";
import { ToneBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatNumber, formatPercent, formatUsd } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { DepartmentOverview } from "@/lib/types";
import { cn } from "@/lib/utils";

const SORTS = {
  default: { label: "Company order", fn: () => 0 },
  busiest: {
    label: "Busiest first",
    fn: (a: DepartmentOverview, b: DepartmentOverview) =>
      b.running_tasks + b.queued_tasks - (a.running_tasks + a.queued_tasks),
  },
  agents: { label: "Largest team", fn: (a: DepartmentOverview, b: DepartmentOverview) => b.agents_total - a.agents_total },
  cost: { label: "Highest cost", fn: (a: DepartmentOverview, b: DepartmentOverview) => b.total_cost_usd - a.total_cost_usd },
  name: { label: "Name A–Z", fn: (a: DepartmentOverview, b: DepartmentOverview) => a.name.localeCompare(b.name) },
};
type Sort = keyof typeof SORTS;

const sum = (rows: DepartmentOverview[], key: keyof DepartmentOverview) =>
  rows.reduce((total, d) => total + (d[key] as number), 0);

function Workload({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2 text-center">
      <div className={cn("text-base font-semibold tabular-nums", value ? tone : "text-muted-foreground/60")}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DepartmentCard({ d }: { d: DepartmentOverview }) {
  const shown = d.team.slice(0, 5);
  return (
    <Link href={`/departments/${d.key}`} className="group block focus-visible:outline-none">
      <Card className="h-full gap-0 p-0 transition group-hover:shadow-md group-hover:ring-primary/30 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <div className="flex items-start gap-3 p-5 pb-4">
          <DepartmentIcon department={d.key} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="truncate font-semibold group-hover:text-primary">{d.name}</h2>
              {d.blocked > 0 ? (
                <ToneBadge tone="red">{d.blocked} blocked</ToneBadge>
              ) : d.agents_working > 0 ? (
                <ToneBadge tone="violet">
                  <span className="size-1.5 animate-pulse rounded-full bg-violet-500" />
                  {d.agents_working} working
                </ToneBadge>
              ) : (
                <ToneBadge>Idle</ToneBadge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{d.head ? `Led by ${d.head.name}` : "No head assigned"}</p>
          </div>
        </div>
        <p className="line-clamp-2 min-h-10 px-5 text-sm text-muted-foreground">{d.description}</p>

        <div className="grid grid-cols-4 gap-2 px-5 pt-4">
          <Workload label="Running" value={d.running_tasks} tone="text-violet-600" />
          <Workload label="Queued" value={d.queued_tasks} tone="text-sky-600" />
          <Workload label="In review" value={d.in_review} tone="text-amber-600" />
          <Workload label="Approval" value={d.awaiting_approval} tone="text-amber-600" />
        </div>

        <div className="space-y-2 px-5 pt-4 pb-5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">QA first-pass rate</span>
            <span className="font-medium tabular-nums">{formatPercent(d.first_pass_acceptance_rate)}</span>
          </div>
          <ProgressBar value={d.first_pass_acceptance_rate ?? 0} max={1} tone="green" />
          <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
            <span>
              {formatNumber(d.tasks_completed)} completed
              {d.tasks_failed > 0 && <span className="text-rose-600"> · {d.tasks_failed} failed</span>}
            </span>
            <span>Avg cycle {formatDuration(d.mean_task_completion_seconds)}</span>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t px-5 py-3">
          <div className="flex items-center">
            <div className="flex -space-x-1.5">
              {shown.map((a) => (
                <AgentAvatar key={a.id} name={a.name} role={a.role_type} size="sm" className="rounded-lg ring-2 ring-card" />
              ))}
            </div>
            <span className="ml-2 text-xs text-muted-foreground">
              {d.agents_active}/{d.agents_total} active
            </span>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {formatUsd(d.total_cost_usd)}
            <ChevronRight className="size-4 transition group-hover:translate-x-0.5 group-hover:text-primary" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

export default function DepartmentsPage() {
  const { data, error, errorStatus, refreshing, updatedAt, reload } = useApi<DepartmentOverview[]>(
    "/api/departments/overview",
    15000,
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("default");

  const shown = useMemo(
    () =>
      (data ?? [])
        .filter((d) => matches(query, d.name, d.description, d.head?.name, ...d.team.map((a) => a.name)))
        .sort(SORTS[sort].fn),
    [data, query, sort],
  );

  const header = (
    <PageHeader
      title="Departments"
      subtitle={
        data
          ? `${data.length} departments · ${sum(data, "agents_total")} agents · ${sum(data, "agents_working")} working now`
          : "Each department's team, workload, quality and cost."
      }
      actions={<SyncStatus updatedAt={updatedAt} refreshing={refreshing} error={data ? error : null} onRefresh={reload} />}
    />
  );

  if (!data && error) {
    return (
      <>
        {header}
        <PageError message={error} status={errorStatus} onRetry={reload} />
      </>
    );
  }

  return (
    <>
      {header}
      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Active agents"
              value={`${sum(data, "agents_active")} / ${sum(data, "agents_total")}`}
              hint={`across ${data.length} departments`}
              icon={<Bot />}
            />
            <StatCard
              label="Working now"
              value={sum(data, "agents_working")}
              hint={`${sum(data, "running_tasks")} tasks running`}
              tone="violet"
              icon={<Activity />}
            />
            <StatCard
              label="Queued work"
              value={sum(data, "queued_tasks")}
              hint={`${sum(data, "in_review")} in review · ${sum(data, "awaiting_approval")} awaiting approval`}
              tone={sum(data, "blocked") ? "red" : "blue"}
              icon={<ListTodo />}
            />
            <StatCard
              label="Cost to date"
              value={formatUsd(sum(data, "total_cost_usd"))}
              hint={`${formatNumber(sum(data, "tasks_completed"))} tasks completed`}
              tone="green"
              icon={<DollarSign />}
            />
          </div>

          <div className="mt-6 mb-4 flex flex-wrap items-center gap-3">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search departments, leads or agents…"
              className="w-full sm:w-80"
            />
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="w-44" aria-label="Sort departments">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORTS) as Sort[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SORTS[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {query && (
              <span className="text-sm text-muted-foreground">
                {shown.length} of {data.length}
              </span>
            )}
          </div>

          {shown.length === 0 ? (
            <Card>
              <EmptyState
                title={`No departments match “${query}”`}
                hint={
                  <Button variant="link" className="h-auto p-0" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((d) => (
                <DepartmentCard key={d.id} d={d} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
