"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge, ButtonLink, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge, Table, Td, inputClass } from "@/components/ui";
import { formatDate, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { progressOf } from "@/lib/project";
import type { Project } from "@/lib/types";

const STATUSES = ["submitted", "in_progress", "awaiting_approval", "paused", "completed", "failed", "cancelled"];

export default function ProjectsPage() {
  const [status, setStatus] = useState("");
  const { data, error } = useApi<Project[]>(`/api/projects${status ? `?status=${status}` : ""}`, 10000);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Client projects, their task plans and delivery status."
        actions={
          <ButtonLink href="/projects/new" variant="primary">
            <Plus className="h-4 w-4" /> New project
          </ButtonLink>
        }
      />
      <ErrorBanner message={error} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <select className={`${inputClass} max-w-[14rem]`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        {!data ? (
          <Spinner />
        ) : data.length === 0 ? (
          <EmptyState title="No projects" hint="Create a project for a client or let clients submit work from their portal." />
        ) : (
          <Table head={["Project", "Client", "Status", "Progress", "Spend", "Created", ""]}>
            {data.map((p) => {
              const { done, total } = progressOf(p);
              return (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/projects/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {p.title}
                    </Link>
                    {p.objective && <div className="max-w-md truncate text-xs text-slate-500">{p.objective}</div>}
                  </Td>
                  <Td>{p.client_name}</Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                  <Td className="tabular-nums">
                    {done}/{total} tasks
                  </Td>
                  <Td className="tabular-nums">
                    {formatUsd(p.spent_usd)}
                    {p.budget_usd && <span className="text-slate-400"> / {formatUsd(p.budget_usd)}</span>}
                  </Td>
                  <Td>{formatDate(p.created_at)}</Td>
                  <Td>
                    {p.pending_approvals > 0 && <Badge tone="amber">{p.pending_approvals} approval(s)</Badge>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
