"use client";

import { AlertCircle, CheckCircle2, DollarSign, FolderKanban, Plus, Rocket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { SearchInput, matches } from "@/components/shared/SearchInput";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatUsd, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { progressOf } from "@/lib/project";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTIVE = ["submitted", "in_progress", "awaiting_approval", "paused"];
const VIEWS = {
  all: { label: "All", test: () => true },
  active: { label: "Active", test: (p: Project) => ACTIVE.includes(p.status) },
  attention: { label: "Needs attention", test: (p: Project) => p.pending_approvals > 0 || p.needs_client_input },
  completed: { label: "Completed", test: (p: Project) => p.status === "completed" },
  closed: { label: "Failed / cancelled", test: (p: Project) => p.status === "failed" || p.status === "cancelled" },
};
type View = keyof typeof VIEWS;

const SORTS = {
  newest: { label: "Newest first", fn: (a: Project, b: Project) => b.created_at.localeCompare(a.created_at) },
  updated: { label: "Recently updated", fn: (a: Project, b: Project) => b.updated_at.localeCompare(a.updated_at) },
  priority: { label: "Priority", fn: (a: Project, b: Project) => a.priority - b.priority },
  spend: { label: "Highest spend", fn: (a: Project, b: Project) => Number(b.spent_usd) - Number(a.spent_usd) },
  deadline: {
    label: "Deadline",
    fn: (a: Project, b: Project) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
  },
};
type Sort = keyof typeof SORTS;

const PRIORITY = ["", "bg-rose-500", "bg-orange-400", "bg-sky-400", "bg-slate-300", "bg-slate-200"];
const PAGE = 25;

export default function ProjectsPage() {
  const router = useRouter();
  const { data, error, errorStatus, refreshing, updatedAt, reload } = useApi<Project[]>("/api/projects", 10000);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [limit, setLimit] = useState(PAGE);

  const clients = useMemo(
    () => [...new Map((data ?? []).map((p) => [p.client_id, p.client_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [data],
  );
  const filtered = useMemo(
    () =>
      (data ?? [])
        .filter(
          (p) =>
            VIEWS[view].test(p) &&
            (client === "all" || p.client_id === client) &&
            matches(query, p.title, p.client_name, p.objective, p.request),
        )
        .sort(SORTS[sort].fn),
    [data, view, client, query, sort],
  );
  const filtering = view !== "all" || client !== "all" || Boolean(query);
  const resetFilters = () => {
    setView("all");
    setClient("all");
    setQuery("");
  };

  const header = (
    <PageHeader
      title="Projects"
      subtitle="Client projects, their task plans and delivery status."
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
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-96 rounded-xl" />
          </div>
        )}
      </>
    );
  }

  const active = data.filter(VIEWS.active.test);
  const attention = data.filter(VIEWS.attention.test);
  const spend = data.reduce((total, p) => total + Number(p.spent_usd), 0);

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active projects" value={active.length} hint={`${data.length} in total`} tone="blue" icon={<Rocket />} />
        <StatCard
          label="Needs attention"
          value={attention.length}
          hint="waiting for approval or client input"
          tone={attention.length ? "amber" : "green"}
          icon={<AlertCircle />}
        />
        <StatCard
          label="Completed"
          value={data.filter(VIEWS.completed.test).length}
          hint="delivered to clients"
          tone="green"
          icon={<CheckCircle2 />}
        />
        <StatCard label="AI spend" value={formatUsd(spend)} hint="across all projects" icon={<DollarSign />} />
      </div>

      <Card className="mt-6 gap-0 py-0">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <Tabs
            value={view}
            onValueChange={(v) => {
              setView(v as View);
              setLimit(PAGE);
            }}
          >
            <TabsList className="h-auto flex-wrap">
              {(Object.keys(VIEWS) as View[]).map((v) => (
                <TabsTrigger key={v} value={v} className="gap-1.5">
                  {VIEWS[v].label}
                  <span className="text-xs text-muted-foreground tabular-nums">{data.filter(VIEWS[v].test).length}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search projects or clients…" className="w-full sm:w-72" />
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger className="w-48" aria-label="Filter by client">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-44" aria-label="Sort projects">
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
          <span className="ml-auto text-sm text-muted-foreground">
            {filtered.length} project{filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        {data.length === 0 ? (
          <EmptyState
            title="No projects yet"
            hint={
              <>
                Create a project for a client, or let clients submit work from their portal.{" "}
                <Link href="/projects/new" className="text-primary hover:underline">
                  Create the first project
                </Link>
              </>
            }
            icon={<FolderKanban className="size-5" />}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No projects match these filters"
            hint={
              filtering && (
                <Button variant="link" className="h-auto p-0" onClick={resetFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40">Progress</TableHead>
                  <TableHead className="w-44">Budget</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="pr-5 text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, limit).map((p) => {
                  const { done, total } = progressOf(p);
                  const used = p.budget_usd && Number(p.budget_usd) > 0 ? Number(p.spent_usd) / Number(p.budget_usd) : null;
                  const overdue = p.deadline && ACTIVE.includes(p.status) && new Date(p.deadline).getTime() < Date.now();
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                      <TableCell className="max-w-80 pl-5">
                        <div className="flex items-center gap-2">
                          <span className={cn("size-2 shrink-0 rounded-full", PRIORITY[p.priority])} title={`Priority ${p.priority}`} />
                          <Link
                            href={`/projects/${p.id}`}
                            className="truncate font-medium hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.title}
                          </Link>
                        </div>
                        <div className="mt-0.5 truncate pl-4 text-xs text-muted-foreground">
                          {p.client_name}
                          {p.objective ? ` · ${p.objective}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={p.status} />
                          {p.needs_client_input ? (
                            <ToneBadge tone="blue">client input</ToneBadge>
                          ) : (
                            p.pending_approvals > 0 && <ToneBadge tone="amber">{p.pending_approvals} approval</ToneBadge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ProgressBar value={done} max={total} tone="green" className="h-1.5 flex-1" />
                          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                            {done}/{total}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className={cn("text-xs tabular-nums", used !== null && used >= 1 && "text-rose-600")}>
                          {formatUsd(p.spent_usd)}
                          <span className="text-muted-foreground"> / {p.budget_usd ? formatUsd(p.budget_usd) : "no limit"}</span>
                        </div>
                        {used !== null && (
                          <ProgressBar
                            value={Math.min(used, 1)}
                            max={1}
                            tone={used < 0.8 ? "green" : "primary"}
                            className={cn("mt-1 h-1", used >= 1 && "[&_[data-slot=progress-indicator]]:bg-rose-500")}
                          />
                        )}
                      </TableCell>
                      <TableCell className={cn("text-xs", overdue ? "font-medium text-rose-600" : "text-muted-foreground")}>
                        {p.deadline ? `${overdue ? "Overdue · " : ""}${formatDate(p.deadline)}` : "—"}
                      </TableCell>
                      <TableCell className="pr-5 text-right text-xs text-muted-foreground">{timeAgo(p.updated_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > limit && (
              <div className="border-t px-5 py-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit} remaining
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
