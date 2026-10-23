"use client";

import { Download, Pause, Play, Square, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { ApprovalCard } from "@/components/ApprovalCard";
import { TaskDrawer } from "@/components/TaskDrawer";
import { Timeline } from "@/components/Timeline";
import {
  Badge,
  Bar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Spinner,
  Stat,
  StatusBadge,
  Table,
  Td,
  inputClass,
} from "@/components/ui";
import { download, patch, post, upload } from "@/lib/api";
import { isStaff, isSupervisor, useAuth } from "@/lib/auth";
import { formatBytes, formatDate, formatNumber, formatUsd, humanize } from "@/lib/format";
import { useApi, useLiveEvents } from "@/lib/hooks";
import { progressOf } from "@/lib/project";
import type { Agent, Approval, Artifact, ClientTask, Project, Task } from "@/lib/types";

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

function FilesCard({ project, canUpload, onUploaded }: { project: Project; canUpload: boolean; onUploaded: () => void }) {
  const { data: files, reload } = useApi<Artifact[]>(`/api/projects/${project.id}/artifacts`, 15000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await upload(project.id, file);
      await reload();
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <Card
      title="Files & deliverables"
      padded={false}
      actions={
        canUpload && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload"}
            <input type="file" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        )
      }
    >
      {error && <div className="px-5 pt-3 text-xs text-rose-600">{error}</div>}
      {!files?.length ? (
        <EmptyState title="No files yet" hint="Client uploads and approved deliverables appear here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{f.name}</div>
                <div className="text-xs text-slate-500">
                  {humanize(f.kind)} · {formatBytes(f.size_bytes)} · {formatDate(f.created_at)}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => download(f.id, f.name)}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FinalReport({ project }: { project: Project }) {
  const report = project.final_report;
  if (!report) return null;
  return (
    <Card title="Final report">
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2">
          <Badge tone={report.objective_met ? "green" : "amber"}>{report.objective_met ? "Objective met" : "Objective not fully met"}</Badge>
        </div>
        <p className="text-slate-700">{report.executive_summary}</p>
        <ul className="space-y-2">
          {report.outcomes.map((o) => (
            <li key={o.outcome} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={o.status === "met" ? "approved" : o.status === "not_met" ? "failed" : "in_review"} />
                <span className="font-medium text-slate-800">{o.outcome}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{o.evidence}</div>
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer font-medium text-brand-700">Client deliverable document</summary>
          <pre className="prose-report mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm text-slate-800">
            {report.final_deliverable_markdown}
          </pre>
        </details>
      </div>
    </Card>
  );
}

function ClientView({ project, reload }: { project: Project; reload: () => void }) {
  const { data: tasks } = useApi<ClientTask[]>(`/api/projects/${project.id}/tasks`, 10000);
  const { data: questions, reload: reloadQuestions } = useApi<Approval[]>(`/api/approvals?project_id=${project.id}`, 10000);
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const done = tasks?.filter((t) => t.status === "approved").length ?? 0;
  const order = ["analyze", "plan", "execute", "final_report"];
  const ordered = (tasks ?? []).slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {questions && questions.length > 0 && (
          <Card title="The team needs your input">
            <div className="space-y-3">
              {questions.map((q) => (
                <ApprovalCard key={q.id} approval={q} onDecided={() => { void reloadQuestions(); reload(); }} />
              ))}
            </div>
          </Card>
        )}
        <Card title="Progress">
          <div className="mb-4">
            <Bar value={done} max={tasks?.length ?? 0} tone="bg-emerald-500" />
            <div className="mt-1 text-xs text-slate-500">
              {done} of {tasks?.length ?? 0} work items completed
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {ordered.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="text-slate-800">{t.title}</div>
                  <div className="text-xs text-slate-500">{t.department ?? "Executive"}</div>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        </Card>
        {project.status === "completed" && <FinalReport project={project} />}
        {project.status === "completed" && (
          <Card title="How did we do?">
            {project.satisfaction_score || sent ? (
              <div className="text-sm text-slate-600">Thank you for your feedback.</div>
            ) : (
              <div className="space-y-3">
                <select className={`${inputClass} max-w-[10rem]`} value={score} onChange={(e) => setScore(Number(e.target.value))}>
                  {[5, 4, 3, 2, 1].map((s) => (
                    <option key={s} value={s}>
                      {s} / 5
                    </option>
                  ))}
                </select>
                <textarea className={`${inputClass} h-20`} placeholder="Comments" value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button
                  variant="primary"
                  onClick={async () => {
                    await post(`/api/projects/${project.id}/feedback`, { score, comment: comment || null });
                    setSent(true);
                    reload();
                  }}
                >
                  Send feedback
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
      <div className="space-y-6">
        <Card title="Your request">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{project.request}</p>
        </Card>
        <FilesCard project={project} canUpload={!["completed", "cancelled"].includes(project.status)} onUploaded={reload} />
      </div>
    </div>
  );
}

function StaffView({ project, reload }: { project: Project; reload: () => void }) {
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
  const { events } = useLiveEvents({
    projectId: project.id,
    max: 100,
    onEvent: () => {
      void reloadTasks();
      void reloadApprovals();
      reload();
    },
  });

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
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the budget");
    }
  }

  const refresh = () => {
    void reloadTasks();
    void reloadApprovals();
    reload();
  };

  return (
    <>
      <ErrorBanner message={error} />
      <div className="mb-6 flex flex-wrap gap-2">
        {["in_progress", "submitted"].includes(project.status) && (
          <Button size="sm" onClick={() => control("pause")}>
            <Pause className="h-3.5 w-3.5" /> Pause
          </Button>
        )}
        {project.status === "paused" && (
          <Button size="sm" onClick={() => control("resume")}>
            <Play className="h-3.5 w-3.5" /> Resume
          </Button>
        )}
        {!["completed", "cancelled"].includes(project.status) && (
          <Button size="sm" variant="danger" onClick={() => confirm("Cancel this project and all its tasks?") && control("cancel")}>
            <Square className="h-3.5 w-3.5" /> Cancel project
          </Button>
        )}
        {isSupervisor(user?.role) && (
          <span className="ml-auto flex items-center gap-2 whitespace-nowrap text-sm">
            Budget (USD)
            <input className={`${inputClass} w-28 py-1`} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="none" />
            <Button size="sm" onClick={saveBudget}>
              Save
            </Button>
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {approvals && approvals.length > 0 && (
            <Card title="Waiting for a human decision">
              <div className="space-y-3">
                {approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    canDecide={isSupervisor(user?.role) || a.kind === "clarification"}
                    onDecided={refresh}
                  />
                ))}
              </div>
            </Card>
          )}
          <Card title={`Work breakdown (${tasks?.length ?? 0} tasks)`} padded={false}>
            {!tasks ? (
              <Spinner />
            ) : tasks.length === 0 ? (
              <EmptyState title="No tasks yet" hint="Tasks appear once the project is submitted." />
            ) : (
              <Table head={["Task", "Status", "Attempts", "Cost"]}>
                {asTree(tasks).map(({ task: t, depth }) => {
                  const waitsOn = t.depends_on.map((d) => titles.get(d)).filter(Boolean);
                  return (
                    <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(t.id)}>
                      <Td className="min-w-[18rem]">
                        <div style={{ paddingLeft: depth * 16 }} className={depth ? "border-l border-slate-200 pl-3" : ""}>
                          <div className="font-medium text-slate-800">{t.title}</div>
                          <div className="text-xs text-slate-500">
                            {humanize(t.kind)} · {t.assigned_agent_id ? agentMap.get(t.assigned_agent_id)?.name : "unassigned"}
                          </div>
                          {waitsOn.length > 0 && (
                            <div className="text-xs text-slate-400">waits on: {waitsOn.join(", ")}</div>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={t.status} />
                      </Td>
                      <Td className="tabular-nums">
                        {t.attempt_count}/{t.max_attempts}
                      </Td>
                      <Td className="tabular-nums">{formatUsd(t.cost_usd)}</Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
          <FinalReport project={project} />
        </div>
        <div className="space-y-6">
          <Card title="Client request">
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">{project.request}</p>
            {project.requested_deliverables.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
                {project.requested_deliverables.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </Card>
          {project.objective && (
            <Card title="Objective (CEO agent)">
              <p className="text-sm text-slate-700">{project.objective}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {project.expected_outcomes.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </Card>
          )}
          <FilesCard project={project} canUpload={!["completed", "cancelled"].includes(project.status)} onUploaded={refresh} />
          <Card title="Live activity">
            <div className="max-h-[32rem] overflow-y-auto">
              <Timeline events={events} onTaskClick={setSelected} />
            </div>
          </Card>
        </div>
      </div>
      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={refresh} />
    </>
  );
}

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: project, error, reload } = useApi<Project>(`/api/projects/${id}`, 10000);
  if (!project) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const { done, total } = progressOf(project);
  const staff = isStaff(user?.role);

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={project.status} />
            {staff && <span>{project.client_name}</span>}
            <span>· created {formatDate(project.created_at)}</span>
            {project.needs_client_input && <Badge tone="amber">needs client input</Badge>}
          </span>
        }
        actions={
          <Link href={staff ? "/projects" : "/portal"} className="text-sm text-brand-700 hover:underline">
            ← Back
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Progress" value={`${done}/${total}`} hint="tasks approved" tone="green" />
        <Stat label="AI spend" value={formatUsd(project.spent_usd)} hint={project.budget_usd ? `budget ${formatUsd(project.budget_usd)}` : "no budget cap"} />
        <Stat label="Tokens" value={formatNumber(project.tokens_used)} />
        <Stat label="Deadline" value={project.deadline ? formatDate(project.deadline) : "—"} />
      </div>
      {staff ? <StaffView project={project} reload={() => void reload()} /> : <ClientView project={project} reload={() => void reload()} />}
    </>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProjectDetail />
    </Suspense>
  );
}
