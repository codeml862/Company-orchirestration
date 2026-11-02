"use client";

import { FolderPlus, Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Loading } from "@/components/shared/Loading";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { progressOf } from "@/lib/project";
import type { Project } from "@/lib/types";

export default function PortalPage() {
  const { user } = useAuth();
  const { data, error } = useApi<Project[]>("/api/projects", 10000);
  if (!data) return error ? <ErrorAlert message={error} /> : <Loading />;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.full_name ?? ""}`}
        subtitle="Submit work, follow progress, answer questions from the team and download approved deliverables."
        actions={
          <Button asChild>
            <Link href="/projects/new">
              <Plus /> New request
            </Link>
          </Button>
        }
      />
      {data.length === 0 ? (
        <Card className="border border-dashed border-foreground/15 ring-0">
          <EmptyState
            title="No projects yet"
            hint="Start by describing what you need. Our AI team will plan it and keep you posted."
            icon={<FolderPlus className="size-5" />}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => {
            const { done, total } = progressOf(p);
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="group">
                <Card className="h-full gap-0 p-5 transition group-hover:shadow-md group-hover:ring-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold">{p.title}</div>
                    <StatusBadge status={p.status} />
                  </div>
                  {p.objective && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.objective}</p>}
                  <ProgressBar value={done} max={total} tone="green" className="mt-4" />
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Submitted {formatDate(p.created_at)}</span>
                    {p.needs_client_input && <ToneBadge tone="amber">Your input needed</ToneBadge>}
                    {p.status === "completed" && <ToneBadge tone="green">Deliverables ready</ToneBadge>}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
