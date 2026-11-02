"use client";

import { CircleDashed, Cog, Hourglass, ListTodo, OctagonX, Pause, Play, Radio, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Timeline } from "@/components/activity/Timeline";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchInput, matches } from "@/components/shared/SearchInput";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanize, timeAgo } from "@/lib/format";
import { useApi, useLiveEvents } from "@/lib/hooks";
import type { Agent, Approval, AuditEvent, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS = {
  all: () => true,
  decisions: (e: AuditEvent) => e.action.startsWith("task.created") || e.action === "task.approved" || e.action.startsWith("approval."),
  problems: (e: AuditEvent) => e.severity !== "info",
  retries: (e: AuditEvent) => e.action === "task.ready",
} as const;
type Filter = keyof typeof FILTERS;

const LANES = [
  { status: "running", label: "Running", icon: Cog, tone: "text-violet-600 bg-violet-50" },
  { status: "ready", label: "Queued", icon: ListTodo, tone: "text-sky-600 bg-sky-50" },
  { status: "in_review", label: "In QA review", icon: ScanSearch, tone: "text-amber-600 bg-amber-50" },
  { status: "awaiting_approval", label: "Awaiting approval", icon: Hourglass, tone: "text-amber-600 bg-amber-50" },
  { status: "blocked", label: "Blocked", icon: OctagonX, tone: "text-rose-600 bg-rose-50" },
] as const;

export default function OperationsPage() {
  const activeQuery = useApi<Task[]>(
    "/api/tasks?status=running&status=in_review&status=ready&status=awaiting_approval&status=blocked&limit=200",
    10000,
  );
  const { data: active, reload: reloadActive } = activeQuery;
  const { data: agents, reload: reloadAgents } = useApi<Agent[]>("/api/agents", 15000);
  const { data: approvals } = useApi<Approval[]>("/api/approvals", 10000);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<AuditEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { events, connected } = useLiveEvents({
    max: 300,
    onEvent: (e) => {
      if (e.entity_type === "task") void reloadActive();
      if (e.action === "execution.started" || e.action === "task.approved") void reloadAgents();
    },
  });

  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const count = (status: string) =>
    status === "awaiting_approval" ? (approvals?.length ?? 0) : (active ?? []).filter((t) => t.status === status).length;
  const working = (agents ?? []).filter((a) => a.stats.status === "working");
  const tasks = (active ?? []).filter((t) => !lane || t.status === lane);

  const source = frozen ?? events;
  const newest = frozen?.[0]?.id ?? 0;
  const pending = frozen ? events.filter((e) => e.id > newest).length : 0;
  const shown = source.filter((e) => FILTERS[filter](e) && matches(query, e.message, e.action));

  return (
    <>
      <PageHeader
        title="Live Operations Center"
        subtitle="Every task transition, coordinator decision, retry, approval and error as it happens."
        actions={
          <>
            <ToneBadge tone={frozen ? "amber" : connected ? "green" : "red"} className="h-8 rounded-lg px-3">
              {frozen ? (
                <>
                  <Pause className="size-3" /> Paused
                </>
              ) : connected ? (
                <>
                  <Radio className="size-3 animate-pulse" /> Live
                </>
              ) : (
                <>
                  <CircleDashed className="size-3 animate-spin" /> Reconnecting…
                </>
              )}
            </ToneBadge>
            <Button size="sm" variant="outline" onClick={() => setFrozen(frozen ? null : events)}>
              {frozen ? <Play /> : <Pause />}
              {frozen ? `Resume${pending ? ` (${pending} new)` : ""}` : "Pause feed"}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {LANES.map(({ status, label, icon: Icon, tone }) => {
          const n = count(status);
          const on = lane === status;
          return (
            <button
              key={status}
              onClick={() => setLane(on ? null : status)}
              aria-pressed={on}
              className="text-left focus-visible:outline-none"
            >
              <Card
                className={cn(
                  "gap-0 p-4 transition hover:shadow-md",
                  on && "ring-2 ring-primary",
                  status === "blocked" && n > 0 && "ring-rose-300",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-medium text-muted-foreground">{label}</div>
                  <span className={cn("flex size-8 items-center justify-center rounded-lg", tone)}>
                    <Icon className="size-4" />
                  </span>
                </div>
                <div className={cn("text-2xl font-semibold tabular-nums", status === "blocked" && n > 0 && "text-rose-600")}>
                  {active || status === "awaiting_approval" ? n : "–"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{on ? "Filtering tasks · click to clear" : "Click to filter"}</div>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Activity timeline"
          description={`${shown.length} event${shown.length === 1 ? "" : "s"}${frozen ? " · feed paused" : ""}`}
          className="min-w-0 lg:col-span-2"
          actions={
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="h-8">
                {(Object.keys(FILTERS) as Filter[]).map((f) => (
                  <TabsTrigger key={f} value={f} className="text-xs">
                    {humanize(f)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
        >
          <SearchInput value={query} onChange={setQuery} placeholder="Search events…" className="mb-4" />
          {frozen && pending > 0 && (
            <button
              onClick={() => setFrozen(null)}
              className="mb-3 w-full rounded-lg border border-amber-200 bg-amber-50 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              {pending} new event{pending === 1 ? "" : "s"} · resume live feed
            </button>
          )}
          <div className="max-h-[40rem] overflow-y-auto pr-1">
            {query && !shown.length ? (
              <EmptyState title={`No events match “${query}”`} />
            ) : (
              <Timeline events={shown} showProjectLinks onTaskClick={setSelected} />
            )}
          </div>
        </SectionCard>

        <div className="min-w-0 space-y-6">
          <SectionCard title="Agents working" description={`${working.length} of ${agents?.length ?? "–"}`} flush>
            {!agents ? (
              <div className="p-5">
                <Skeleton className="h-10" />
              </div>
            ) : !working.length ? (
              <EmptyState title="All agents idle" hint="Agents pick up work as soon as tasks are ready." />
            ) : (
              <ul className="max-h-72 divide-y overflow-y-auto">
                {working.map((a) => {
                  const task = (active ?? []).find((t) => t.assigned_agent_id === a.id && t.status === "running");
                  return (
                    <li key={a.id}>
                      <Link href={`/agents/${a.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
                        <AgentAvatar name={a.name} role={a.role_type} status="working" size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{a.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{task?.title ?? "Working…"}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title={lane ? `${humanize(lane)} tasks` : "Active tasks"}
            description={active ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : undefined}
            actions={
              lane && (
                <Button variant="ghost" size="sm" onClick={() => setLane(null)}>
                  Show all
                </Button>
              )
            }
            flush
          >
            {activeQuery.error && !active ? (
              <div className="px-5 py-4 text-sm">
                <p className="text-destructive">{activeQuery.error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void reloadActive()}>
                  Try again
                </Button>
              </div>
            ) : !active ? (
              <div className="space-y-2 p-5">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : !tasks.length ? (
              <EmptyState title={lane ? `No ${humanize(lane).toLowerCase()} tasks` : "No active tasks"} />
            ) : (
              <ul className="max-h-[28rem] divide-y overflow-y-auto">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => setSelected(t.id)} className="w-full px-5 py-2.5 text-left hover:bg-muted/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{t.title}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {t.assigned_agent_id ? (agentMap.get(t.assigned_agent_id)?.name ?? "Agent") : "Unassigned"} · attempt{" "}
                        {t.attempt_count}/{t.max_attempts} · {timeAgo(t.started_at ?? t.created_at)}
                      </div>
                      {t.status === "blocked" && t.last_error && (
                        <div className="mt-0.5 truncate text-xs text-rose-600">{t.last_error}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={() => void reloadActive()} />
    </>
  );
}
