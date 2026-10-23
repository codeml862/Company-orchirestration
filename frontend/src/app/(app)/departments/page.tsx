"use client";

import Link from "next/link";

import { Badge, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { formatPercent, formatUsd } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Department, ExecutiveDashboard } from "@/lib/types";

export default function DepartmentsPage() {
  const { data: departments, error } = useApi<Department[]>("/api/departments");
  const { data: agents } = useApi<Agent[]>("/api/agents", 15000);
  const { data: dashboard } = useApi<ExecutiveDashboard>("/api/dashboard/executive", 15000);
  if (!departments) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <>
      <PageHeader title="Departments" subtitle="Each department's team, workload, queue and reports." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((d) => {
          const team = (agents ?? []).filter((a) => a.department_id === d.id);
          const working = team.filter((a) => a.stats.status === "working").length;
          const perf = dashboard?.departments.find((x) => x.key === d.key);
          return (
            <Link
              key={d.id}
              href={`/departments/${d.key}`}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-900">{d.name}</div>
                {working > 0 && <Badge tone="violet">{working} working</Badge>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{d.description}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{team.length}</div>agents
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">{perf?.tasks_completed ?? 0}</div>tasks done
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">{formatPercent(perf?.first_pass_acceptance_rate)}</div>1st pass
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">Cost to date: {formatUsd(perf?.total_cost_usd ?? 0)}</div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
