"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/EmptyState";
import { Loading } from "@/components/shared/Loading";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatNumber, formatUsd, humanize, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Task } from "@/lib/types";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1 font-medium">{children}</div>
    </div>
  );
}

/** Side panel used by the org chart: who the agent is, what it may do, what it is working on. */
export function AgentPanel({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const { data: agent } = useApi<Agent>(agentId ? `/api/agents/${agentId}` : null);
  const { data: tasks } = useApi<Task[]>(agentId ? `/api/agents/${agentId}/tasks?limit=15` : null);
  const loaded = agent && agent.id === agentId;

  return (
    <Sheet open={!!agentId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{loaded ? agent.name : "Agent"}</SheetTitle>
          <SheetDescription>{loaded ? `${humanize(agent.role_type)} · ${agent.key}` : "Loading agent"}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5">
          {!loaded ? (
            <Loading />
          ) : (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={agent.stats.status} />
                <ToneBadge tone="blue">model tier: {agent.model_tier}</ToneBadge>
              </div>
              <p>{agent.description}</p>
              <div>
                <div className="mb-1 font-medium">Responsibilities</div>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {agent.responsibilities.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Fact label="Tools">
                  {agent.allowed_tools.length ? agent.allowed_tools.map((t) => <ToneBadge key={t}>{t}</ToneBadge>) : "none"}
                </Fact>
                <Fact label="Task kinds">
                  {agent.task_kinds.map((t) => (
                    <ToneBadge key={t} tone="violet">
                      {t}
                    </ToneBadge>
                  ))}
                </Fact>
                <Fact label="Executions">
                  {agent.stats.succeeded} ok · {agent.stats.failed} failed
                </Fact>
                <Fact label="Usage">
                  {formatNumber(agent.stats.tokens)} tokens · {formatUsd(agent.stats.cost_usd)}
                </Fact>
              </div>
              <div>
                <div className="mb-2 font-medium">Recent assignments</div>
                {!tasks?.length ? (
                  <EmptyState title="No assignments yet" />
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <Link href={`/projects/${t.project_id}?task=${t.id}`} className="min-w-0 truncate text-primary hover:underline">
                          {t.title}
                        </Link>
                        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          {timeAgo(t.created_at)}
                          <StatusBadge status={t.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Link href={`/agents/${agent.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Open full configuration and logs <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
