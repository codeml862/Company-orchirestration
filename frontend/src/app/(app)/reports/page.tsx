"use client";

import { CheckCircle2, Clock, FileCheck2, FileText } from "lucide-react";
import Link from "next/link";

import { SubmissionBadge } from "@/components/reports/SubmissionBanner";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { ToneBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { SubmissionSummary } from "@/lib/types";

export default function ReportsPage() {
  const { data, error, errorStatus, refreshing, updatedAt, reload } = useApi<SubmissionSummary[]>("/api/submissions", 15000);

  const header = (
    <PageHeader
      title="Final Reports"
      subtitle="Final reports and delivered work, with who sent what to whom along the way."
      actions={<SyncStatus updatedAt={updatedAt} refreshing={refreshing} error={data ? error : null} onRefresh={reload} />}
    />
  );

  if (!data) {
    return (
      <>
        {header}
        {error ? <PageError message={error} status={errorStatus} onRetry={reload} /> : <Skeleton className="h-64 rounded-xl" />}
      </>
    );
  }

  const submitted = data.filter((s) => s.submission.state === "submitted");
  const waiting = data.filter((s) => s.submission.state === "awaiting_release");

  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Final reports" value={data.length} hint="projects with a CEO report" icon={<FileText />} />
        <StatCard label="Submitted" value={submitted.length} hint="delivered to the client" tone="green" icon={<CheckCircle2 />} />
        <StatCard
          label="Awaiting release"
          value={waiting.length}
          hint="ready, waiting for approval"
          tone={waiting.length ? "amber" : "green"}
          icon={<Clock />}
        />
      </div>

      {data.length === 0 ? (
        <Card className="mt-6 border border-dashed border-foreground/15 ring-0">
          <EmptyState
            title="No final reports yet"
            hint="When the CEO agent finishes a project's final report, it appears here."
            icon={<FileCheck2 className="size-5" />}
          />
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {data.map((s) => (
            <Link key={s.project_id} href={`/reports/${s.project_id}`} className="group">
              <Card className="h-full gap-0 p-5 transition group-hover:shadow-md group-hover:ring-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{s.title}</div>
                    <div className="text-xs text-muted-foreground">{s.client_name}</div>
                  </div>
                  <SubmissionBadge submission={s.submission} />
                </div>
                {s.executive_summary && <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{s.executive_summary}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {s.objective_met !== null && (
                    <ToneBadge tone={s.objective_met ? "green" : "amber"}>
                      {s.objective_met ? "Objective met" : "Objective not fully met"}
                    </ToneBadge>
                  )}
                  <span>
                    {s.files} file{s.files === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto">
                    {s.submission.submitted_at ? `Submitted ${formatDate(s.submission.submitted_at)}` : `Started ${formatDate(s.created_at)}`}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
