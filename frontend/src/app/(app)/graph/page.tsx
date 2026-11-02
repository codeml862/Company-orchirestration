"use client";

import { useState } from "react";

import { AgentPanel } from "@/components/agents/AgentPanel";
import { type CollaborationLink, CompanyGraph } from "@/components/organization/CompanyGraph";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/hooks";
import type { OrgNode } from "@/lib/types";

type OrgChart = { roots: OrgNode[]; agent_count: number; department_count: number };
const NO_LINKS: CollaborationLink[] = [];

export default function CompanyGraphPage() {
  const { data, error, errorStatus, refreshing, updatedAt, reload } = useApi<OrgChart>("/api/org-chart", 10000);
  const { data: collaboration } = useApi<CollaborationLink[]>("/api/org-chart/links", 30000);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100svh-6rem)] min-h-[40rem] flex-col">
      <PageHeader
        title="Company graph"
        subtitle={
          data
            ? `${data.agent_count} agents in ${data.department_count} departments. Hover an agent to see how work flows through it.`
            : "Every agent and how they connect, in one view."
        }
        actions={<SyncStatus updatedAt={updatedAt} refreshing={refreshing} error={data ? error : null} onRefresh={reload} />}
      />
      <div className="-mt-2 min-h-0 flex-1">
        {!data ? (
          error ? (
            <PageError message={error} status={errorStatus} onRetry={reload} />
          ) : (
            <Skeleton className="h-full rounded-xl" />
          )
        ) : (
          <CompanyGraph
            roots={data.roots}
            collaboration={collaboration ?? NO_LINKS}
            focusDepartment={null}
            query=""
            onSelect={setSelected}
          />
        )}
      </div>
      <AgentPanel agentId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
