"use client";

import {
  Ban,
  CheckCircle2,
  CircleHelp,
  Info,
  Loader2,
  OctagonAlert,
  Pencil,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { patch, post } from "@/lib/api";
import { isSupervisor, useAuth } from "@/lib/auth";
import { formatUsd, humanize, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Approval, AuditEvent, Project, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

const usage = (p: Project) => (p.budget_usd && Number(p.budget_usd) > 0 ? Number(p.spent_usd) / Number(p.budget_usd) : null);

function waitedFor(createdAt: string) {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  return hours >= 24 ? "red" : hours >= 4 ? "amber" : "gray";
}

function BudgetRow({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.budget_usd ?? "");
  const [saving, setSaving] = useState(false);
  const ratio = usage(project);
  const tone = ratio === null ? "text-muted-foreground" : ratio >= 1 ? "text-rose-600" : ratio >= 0.8 ? "text-amber-700" : "";

  async function save() {
    const trimmed = String(value).trim();
    if (trimmed && (Number.isNaN(Number(trimmed)) || Number(trimmed) < 0)) {
      toast.error("Enter a budget of 0 or more, or leave it empty for no limit");
      return;
    }
    setSaving(true);
    try {
      await patch(`/api/projects/${project.id}`, { budget_usd: trimmed || null });
      toast.success(trimmed ? `Budget for ${project.title} set to ${formatUsd(trimmed)}` : `Budget limit removed for ${project.title}`);
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the budget");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="px-5 py-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/projects/${project.id}`} className="min-w-0 truncate text-sm font-medium hover:text-primary">
          {project.title}
        </Link>
        {!editing && (
          <span className={cn("shrink-0 text-xs tabular-nums", tone)}>
            {formatUsd(project.spent_usd)} / {project.budget_usd ? formatUsd(project.budget_usd) : "no limit"}
          </span>
        )}
      </div>
      {editing ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="No limit"
            className="h-8"
            aria-label={`Budget for ${project.title} in USD`}
            autoFocus
          />
          <Button size="sm" type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <Button size="icon" variant="ghost" type="button" className="size-8" onClick={() => setEditing(false)} aria-label="Cancel">
            <X />
          </Button>
        </form>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar
            value={Math.min(ratio ?? 0, 1)}
            max={1}
            tone={ratio !== null && ratio < 0.8 ? "green" : "primary"}
            className={cn("h-1.5 flex-1", ratio !== null && ratio >= 1 && "[&_[data-slot=progress-indicator]]:bg-rose-500")}
          />
          {canEdit && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => {
                setValue(project.budget_usd ?? "");
                setEditing(true);
              }}
              aria-label={`Edit budget for ${project.title}`}
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export default function SupervisorPage() {
  const { user } = useAuth();
  const supervisor = isSupervisor(user?.role);
  const approvalsQuery = useApi<Approval[]>("/api/approvals", 8000);
  const { data: approvals, reload } = approvalsQuery;
  const problemsQuery = useApi<Task[]>("/api/tasks?status=failed&status=blocked&limit=100", 10000);
  const { data: problems, reload: reloadProblems } = problemsQuery;
  const { data: projects, reload: reloadProjects } = useApi<Project[]>("/api/projects", 15000);
  const { data: agents } = useApi<Agent[]>("/api/agents");
  const { data: alerts } = useApi<AuditEvent[]>("/api/events?severity=error&limit=30", 15000);
  const [kind, setKind] = useState("all");
  const [order, setOrder] = useState<"oldest" | "newest">("oldest");
  const [selected, setSelected] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Task | null>(null);
  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const projectTitle = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.title])), [projects]);

  async function taskAction(task: Task, action: "retry" | "cancel") {
    setBusyTask(task.id);
    try {
      await post(`/api/tasks/${task.id}/${action}`);
      toast.success(action === "retry" ? `Retrying “${task.title}”` : `Cancelled “${task.title}”`);
      void reloadProblems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not ${action} the task`);
    } finally {
      setBusyTask(null);
    }
  }

  const header = (
    <PageHeader
      title="Human Supervisor Console"
      subtitle="Approvals, exceptions, spending limits and manual intervention."
      actions={
        <SyncStatus
          updatedAt={approvalsQuery.updatedAt}
          refreshing={approvalsQuery.refreshing}
          error={approvals ? approvalsQuery.error : null}
          onRefresh={() => {
            void reload();
            void reloadProblems();
            void reloadProjects();
          }}
        />
      }
    />
  );

  if (!approvals) {
    return (
      <>
        {header}
        {approvalsQuery.error ? (
          <PageError message={approvalsQuery.error} status={approvalsQuery.errorStatus} onRetry={reload} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
            <Skeleton className="h-72 rounded-xl lg:col-span-4" />
          </div>
        )}
      </>
    );
  }

  const kinds = [...new Set(approvals.map((a) => a.kind))];
  const shown = approvals
    .filter((a) => kind === "all" || a.kind === kind)
    .sort((a, b) => (order === "oldest" ? 1 : -1) * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
  const spending = (projects ?? [])
    .filter((p) => !["completed", "cancelled"].includes(p.status))
    .sort((a, b) => (usage(b) ?? -1) - (usage(a) ?? -1));
  const overBudget = spending.filter((p) => (usage(p) ?? 0) >= 1).length;
  const nearBudget = spending.filter((p) => (usage(p) ?? 0) >= 0.8 && (usage(p) ?? 0) < 1).length;
  const clarifications = approvals.filter((a) => a.kind === "clarification").length;

  return (
    <>
      {header}
      {!supervisor && (
        <Alert className="mb-6 border-sky-200 bg-sky-50 text-sky-900">
          <Info />
          <AlertDescription className="text-sky-900/80">
            You can answer clarification questions. Other decisions require the supervisor role.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Waiting for a decision"
          value={approvals.length}
          hint={approvals.length ? `oldest ${timeAgo(shown.at(order === "oldest" ? 0 : -1)?.created_at)}` : "queue is empty"}
          tone={approvals.length ? "amber" : "green"}
          icon={<ShieldCheck />}
        />
        <StatCard label="Client questions" value={clarifications} hint="clarifications to answer" tone="blue" icon={<CircleHelp />} />
        <StatCard
          label="Exceptions"
          value={problems?.length ?? "–"}
          hint="failed or blocked tasks"
          tone={problems?.length ? "red" : "green"}
          icon={<ShieldAlert />}
        />
        <StatCard
          label="Over budget"
          value={overBudget}
          hint={nearBudget ? `${nearBudget} above 80% of budget` : `${spending.length} active project(s)`}
          tone={overBudget ? "red" : nearBudget ? "amber" : "green"}
          icon={<Wallet />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={kind} onValueChange={setKind}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="all">All ({approvals.length})</TabsTrigger>
                {kinds.map((k) => (
                  <TabsTrigger key={k} value={k}>
                    {humanize(k)} ({approvals.filter((a) => a.kind === k).length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Select value={order} onValueChange={(v) => setOrder(v as "oldest" | "newest")}>
              <SelectTrigger size="sm" className="w-36" aria-label="Sort approvals">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="newest">Newest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {shown.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing waiting for a decision"
                hint="Agents create approval requests for sensitive actions, budget overruns, clarifications and final deliveries."
                icon={<CheckCircle2 className="size-5" />}
              />
            </Card>
          ) : (
            shown.map((a) => (
              <div key={a.id}>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <Link href={`/projects/${a.project_id}`} className="truncate hover:text-primary">
                    {projectTitle.get(a.project_id) ?? "Project"}
                  </Link>
                  <span
                    className={cn(
                      "shrink-0",
                      waitedFor(a.created_at) === "red" && "font-medium text-rose-600",
                      waitedFor(a.created_at) === "amber" && "text-amber-700",
                    )}
                  >
                    waiting {timeAgo(a.created_at).replace(" ago", "")}
                  </span>
                </div>
                <ApprovalCard approval={a} showProject canDecide={supervisor || a.kind === "clarification"} onDecided={() => void reload()} />
              </div>
            ))
          )}
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          <SectionCard title="Exceptions" description="Failed and blocked tasks" flush>
            {problemsQuery.error && !problems ? (
              <p className="px-5 py-4 text-sm text-destructive">{problemsQuery.error}</p>
            ) : !problems ? (
              <div className="p-5">
                <Skeleton className="h-12" />
              </div>
            ) : !problems.length ? (
              <EmptyState title="No exceptions" hint="Failed and blocked tasks appear here." icon={<CheckCircle2 className="size-5" />} />
            ) : (
              <ul className="max-h-[26rem] divide-y overflow-y-auto">
                {problems.map((t) => (
                  <li key={t.id} className="px-5 py-3">
                    <button onClick={() => setSelected(t.id)} className="w-full text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium hover:text-primary">{t.title}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{projectTitle.get(t.project_id)}</div>
                      {t.last_error && <div className="mt-1 line-clamp-2 text-xs text-rose-600">{t.last_error}</div>}
                    </button>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={busyTask === t.id}
                        onClick={() => void taskAction(t, "retry")}
                      >
                        {busyTask === t.id ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-muted-foreground hover:text-destructive"
                        disabled={busyTask === t.id}
                        onClick={() => setCancelling(t)}
                      >
                        <Ban /> Cancel
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Spending by active project" description="Highest budget use first" flush>
            {!projects ? (
              <div className="p-5">
                <Skeleton className="h-12" />
              </div>
            ) : !spending.length ? (
              <EmptyState title="No active projects" />
            ) : (
              <ul className="max-h-[26rem] divide-y overflow-y-auto">
                {spending.map((p) => (
                  <BudgetRow key={p.id} project={p} canEdit={supervisor} onSaved={() => void reloadProjects()} />
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Errors & security alerts" flush>
            {!alerts?.length ? (
              <EmptyState title="No errors recorded" icon={<CheckCircle2 className="size-5" />} />
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto">
                {alerts.map((e) => (
                  <li key={e.id} className="flex gap-3 px-5 py-2.5 text-sm">
                    <OctagonAlert className="mt-0.5 size-4 shrink-0 text-rose-500" />
                    <div className="min-w-0">
                      <div className="break-words">{e.message}</div>
                      <div className="text-xs text-muted-foreground">{timeAgo(e.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <AlertDialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this task?</AlertDialogTitle>
            <AlertDialogDescription>
              “{cancelling?.title}” will be cancelled and every task that depends on it will be blocked. This cannot be
              undone; you can only retry the blocked tasks later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep task</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => cancelling && void taskAction(cancelling, "cancel")}
            >
              Cancel task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={() => void reloadProblems()} />
    </>
  );
}
