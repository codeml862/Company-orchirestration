"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { Badge, Bar, ButtonLink, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { progressOf } from "@/lib/project";
import type { Project } from "@/lib/types";

export default function PortalPage() {
  const { user } = useAuth();
  const { data, error } = useApi<Project[]>("/api/projects", 10000);
  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.full_name ?? ""}`}
        subtitle="Submit work, follow progress, answer questions from the team and download approved deliverables."
        actions={
          <ButtonLink href="/projects/new" variant="primary">
            <Plus className="h-4 w-4" /> New request
          </ButtonLink>
        }
      />
      {data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white">
          <EmptyState title="No projects yet" hint="Start by describing what you need. Our AI team will plan it and keep you posted." />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => {
            const { done, total } = progressOf(p);
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold text-slate-900">{p.title}</div>
                  <StatusBadge status={p.status} />
                </div>
                {p.objective && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.objective}</p>}
                <div className="mt-4">
                  <Bar value={done} max={total} tone="bg-emerald-500" />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>Submitted {formatDate(p.created_at)}</span>
                  {p.needs_client_input && <Badge tone="amber">Your input needed</Badge>}
                  {p.status === "completed" && <Badge tone="green">Deliverables ready</Badge>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
