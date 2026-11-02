"use client";

import { ListTree, Pause, Play, Square } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Timeline } from "@/components/activity/Timeline";
import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Loading } from "@/components/shared/Loading";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { patch, post } from "@/lib/api";
import { isSupervisor, useAuth } from "@/lib/auth";
import { formatUsd, humanize } from "@/lib/format";
import { useApi, useLiveEvents } from "@/lib/hooks";
import type { Agent, Approval, Project, Task } from "@/lib/types";

import { FilesCard } from "./FilesCard";
import { FinalReportCard } from "./FinalReportCard";

/** Orders tasks as a tree (parent -> children) so the delegation structure is visible. */
function asTree(tasks: Task[]): { task: Task; depth: number }[] {
  const byParent = new Map<string | null, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const parent = t.parent_task_id && ids.has(t.parent_task_id) ? t.parent_task_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), t]);
  }
  const out: { task: Task; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of byParent.get(parent) ?? []) {
      out.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function StaffProjectView({ project, reload }: { project: Project; reload: () => void }) {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const { data: tasks, reload: reloadTasks } = useApi<Task[]>(`/api/projects/${project.id}/tasks`, 8000);
  const { data: agents } = useApi<Agent[]>("/api/agents");
  const { data: approvals, reload: reloadApprovals } = useApi<Approval[]>(`/api/approvals?project_id=${project.id}`, 8000);
  const [selected, setSelected] = useState<string | null>(searchParams.get("task"));
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState(project.budget_usd ?? "");
  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const titles = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t.title])), [tasks]);
  const supervisor = isSupervisor(user?.role);

  const refresh = () => {
    void reloadTasks();
    void reloadApprovals();
    reload();
  };
  const { events } = useLiveEvents({ projectId: project.id, max: 100, onEvent: refresh });

  async function control(action: "pause" | "resume" | "cancel") {
    setError(null);
    try {
      await post(`/api/projects/${project.id}/${action}`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function saveBudget() {
    setError(null);
    try {
      await patch(`/api/projects/${project.id}`, { budget_usd: budget === "" ? null : budget });
      toast.success("Budget updated");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the budget");
    }
  }

  return (
    <>
      <ErrorAlert message={error} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {["in_progress", "submitted"].includes(project.status) && (
          <Button size="sm" variant="outline" onClick={() => control("pause")}>
            <Pause /> Pause
          </Button>
        )}
        {project.status === "paused" && (
          <Button size="sm" variant="outline" onClick={() => control("resume")}>
            <Play /> Resume
          </Button>
        )}
        {!["completed", "cancelled"].includes(project.status) && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive">
                <Square /> Cancel project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this project?</AlertDialogTitle>
                <AlertDialogDescription>
                  All open tasks are cancelled and pending approvals are rejected. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep working</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => void control("cancel")}
                >
                  Cancel project
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {supervisor && (
          <div className="ml-auto flex items-center gap-2 whitespace-nowrap text-sm">
            <label htmlFor="project-budget" className="text-muted-foreground">
              Budget (USD)
            </label>
            <Input
              id="project-budget"
              className="h-8 w-28"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="none"
            />
            <Button size="sm" variant="outline" onClick={saveBudget}>
              Save
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {approvals && approvals.length > 0 && (
            <SectionCard title="Waiting for a human decision">
              <div className="space-y-3">
                {approvals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} canDecide={supervisor || a.kind === "clarification"} onDecided={refresh} />
                ))}
              </div>
            </SectionCard>
          )}
          <SectionCard title={`Work breakdown (${tasks?.length ?? 0} tasks)`} flush>
            {!tasks ? (
              <Loading />
            ) : tasks.length === 0 ? (
              <EmptyState title="No tasks yet" hint="Tasks appear once the project is submitted." icon={<ListTree className="size-5" />} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Task</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead className="pr-5 text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {asTree(tasks).map(({ task: t, depth }) => {
                    const waitsOn = t.depends_on.map((d) => titles.get(d)).filter(Boolean);
                    return (
                      <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t.id)}>
                        <TableCell className="min-w-[18rem] whitespace-normal pl-5">
                          <div style={{ paddingLeft: depth * 16 }} className={depth ? "border-l pl-3" : ""}>
                            <div className="font-medium">{t.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {humanize(t.kind)} · {t.assigned_agent_id ? agentMap.get(t.assigned_agent_id)?.name : "unassigned"}
                            </div>
                            {waitsOn.length > 0 && (
                              <div className="text-xs text-muted-foreground/80">waits on: {waitsOn.join(", ")}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {t.attempt_count}/{t.max_attempts}
                        </TableCell>
                        <TableCell className="pr-5 text-right tabular-nums">{formatUsd(t.cost_usd)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </SectionCard>
          <FinalReportCard project={project} />
        </div>
        <div className="space-y-6">
          <SectionCard title="Client request">
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm">{project.request}</p>
            {project.requested_deliverables.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
                {project.requested_deliverables.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </SectionCard>
          {project.objective && (
            <SectionCard title="Objective (CEO agent)">
              <p className="text-sm">{project.objective}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {project.expected_outcomes.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </SectionCard>
          )}
          <FilesCard project={project} canUpload={!["completed", "cancelled"].includes(project.status)} onUploaded={refresh} />
          <SectionCard title="Live activity">
            <div className="max-h-[32rem] overflow-y-auto">
              <Timeline events={events} onTaskClick={setSelected} />
            </div>
          </SectionCard>
        </div>
      </div>
      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={refresh} />
    </>
  );
}
