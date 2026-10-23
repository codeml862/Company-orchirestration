"use client";

import Link from "next/link";

import { useApi } from "@/lib/hooks";
import { formatNumber, formatUsd, humanize, timeAgo } from "@/lib/format";
import type { Agent, Task } from "@/lib/types";

import { Badge, Drawer, EmptyState, Spinner, StatusBadge } from "./ui";

/** Side panel used by the org chart: who the agent is, what it may do, what it is working on. */
export function AgentPanel({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const { data: agent } = useApi<Agent>(agentId ? `/api/agents/${agentId}` : null);
  const { data: tasks } = useApi<Task[]>(agentId ? `/api/agents/${agentId}/tasks?limit=15` : null);

  return (
    <Drawer open={!!agentId} onClose={onClose} title={agent?.name ?? "Agent"} width="max-w-xl">
      {!agent || agent.id !== agentId ? (
        <Spinner />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={agent.stats.status} />
            <Badge>{humanize(agent.role_type)}</Badge>
            <Badge tone="blue">model tier: {agent.model_tier}</Badge>
            <span className="text-xs text-slate-500">key: {agent.key}</span>
          </div>
          <p className="text-slate-700">{agent.description}</p>
          <div>
            <div className="mb-1 font-medium text-slate-800">Responsibilities</div>
            <ul className="list-disc space-y-1 pl-5 text-slate-700">
              {agent.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Tools</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {agent.allowed_tools.length ? agent.allowed_tools.map((t) => <Badge key={t}>{t}</Badge>) : "none"}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Task kinds</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {agent.task_kinds.map((t) => (
                  <Badge key={t} tone="violet">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Executions</div>
              <div className="mt-1 font-medium">
                {agent.stats.succeeded} ok · {agent.stats.failed} failed
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Usage</div>
              <div className="mt-1 font-medium">
                {formatNumber(agent.stats.tokens)} tokens · {formatUsd(agent.stats.cost_usd)}
              </div>
            </div>
          </div>
          <div>
            <div className="mb-2 font-medium text-slate-800">Recent assignments</div>
            {!tasks?.length ? (
              <EmptyState title="No assignments yet" />
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <Link href={`/projects/${t.project_id}?task=${t.id}`} className="min-w-0 truncate text-brand-700 hover:underline">
                      {t.title}
                    </Link>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                      {timeAgo(t.created_at)}
                      <StatusBadge status={t.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link href={`/agents/${agent.id}`} className="inline-block text-sm font-medium text-brand-700 hover:underline">
            Open full configuration and logs →
          </Link>
        </div>
      )}
    </Drawer>
  );
}
