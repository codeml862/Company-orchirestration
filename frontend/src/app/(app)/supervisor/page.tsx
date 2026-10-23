"use client";

import { useMemo, useState } from "react";

import { ApprovalCard } from "@/components/ApprovalCard";
import { TaskDrawer } from "@/components/TaskDrawer";
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge, Table, Td, cn } from "@/components/ui";
import { isSupervisor, useAuth } from "@/lib/auth";
import { formatUsd, humanize, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Approval, AuditEvent, Project, Task } from "@/lib/types";

export default function SupervisorPage() {
  const { user } = useAuth();
  const supervisor = isSupervisor(user?.role);
  const { data: approvals, error, reload } = useApi<Approval[]>("/api/approvals", 8000);
  const { data: problems, reload: reloadProblems } = useApi<Task[]>("/api/tasks?status=failed&status=blocked&limit=100", 10000);
  const { data: projects } = useApi<Project[]>("/api/projects", 15000);
  const { data: agents } = useApi<Agent[]>("/api/agents");
  const { data: alerts } = useApi<AuditEvent[]>("/api/events?severity=error&limit=30", 15000);
  const [kind, setKind] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const projectTitle = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.title])), [projects]);

  if (!approvals) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const kinds = [...new Set(approvals.map((a) => a.kind))];
  const shown = approvals.filter((a) => !kind || a.kind === kind);
  const spending = (projects ?? []).filter((p) => !["completed", "cancelled"].includes(p.status));

  return (
    <>
      <PageHeader
        title="Human Supervisor Console"
        subtitle="Approvals, exceptions, spending limits and manual intervention."
      />
      {!supervisor && (
        <div className="mb-4 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-800">
          You can answer clarification questions. Other decisions require the supervisor role.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setKind("")}
              className={cn("rounded-full px-3 py-1 text-xs font-medium", !kind ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-300")}
            >
              All ({approvals.length})
            </button>
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn("rounded-full px-3 py-1 text-xs font-medium", kind === k ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-300")}
              >
                {humanize(k)} ({approvals.filter((a) => a.kind === k).length})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <Card>
              <EmptyState title="Nothing waiting for a decision" hint="Agents create approval requests for sensitive actions, budget overruns, clarifications and final deliveries." />
            </Card>
          ) : (
            shown.map((a) => (
              <div key={a.id}>
                <div className="mb-1 text-xs text-slate-500">{projectTitle.get(a.project_id) ?? "Project"}</div>
                <ApprovalCard approval={a} showProject canDecide={supervisor || a.kind === "clarification"} onDecided={() => void reload()} />
              </div>
            ))
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Exceptions: failed & blocked tasks" padded={false}>
            {!problems?.length ? (
              <EmptyState title="No exceptions" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {problems.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => setSelected(t.id)} className="w-full px-4 py-2.5 text-left hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{t.title}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="truncate text-xs text-slate-500">{t.last_error ?? projectTitle.get(t.project_id)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Spending by active project" padded={false}>
            {!spending.length ? (
              <EmptyState title="No active projects" />
            ) : (
              <Table head={["Project", "Spent", "Budget"]}>
                {spending.map((p) => {
                  const over = p.budget_usd !== null && Number(p.spent_usd) >= Number(p.budget_usd);
                  return (
                    <tr key={p.id}>
                      <Td>
                        <a href={`/projects/${p.id}`} className="text-slate-800 hover:text-brand-700">
                          {p.title}
                        </a>
                      </Td>
                      <Td className="tabular-nums">{formatUsd(p.spent_usd)}</Td>
                      <Td>{p.budget_usd ? <Badge tone={over ? "red" : "gray"}>{formatUsd(p.budget_usd)}</Badge> : "none"}</Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
          <Card title="Errors & security alerts" padded={false}>
            {!alerts?.length ? (
              <EmptyState title="No errors recorded" />
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {alerts.map((e) => (
                  <li key={e.id} className="px-4 py-2 text-sm">
                    <div className="text-slate-800">{e.message}</div>
                    <div className="text-xs text-slate-500">{timeAgo(e.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <TaskDrawer taskId={selected} agents={agentMap} onClose={() => setSelected(null)} onChanged={() => void reloadProblems()} />
    </>
  );
}
