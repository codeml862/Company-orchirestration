"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, FileText, Inbox, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { FinalReportCard } from "@/components/projects/FinalReportCard";
import { FileTree } from "@/components/reports/FileTree";
import { SubmissionBanner } from "@/components/reports/SubmissionBanner";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageError } from "@/components/shared/SyncStatus";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isStaff, useAuth } from "@/lib/auth";
import { formatDate, formatNumber, formatUsd } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Handoff, SubmissionDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPES = {
  assignment: { label: "Assigned", icon: Send, dot: "bg-sky-500" },
  result: { label: "Sent result", icon: Inbox, dot: "bg-emerald-500" },
  review: { label: "Reviewed", icon: ClipboardCheck, dot: "bg-violet-500" },
  escalation: { label: "Escalated", icon: AlertTriangle, dot: "bg-amber-500" },
  submission: { label: "Final submission", icon: CheckCircle2, dot: "bg-emerald-600" },
} as const;

const FILTERS = {
  all: { label: "All", test: () => true },
  assignment: { label: "Assignments", test: (h: Handoff) => h.type === "assignment" },
  result: { label: "Results", test: (h: Handoff) => h.type === "result" || h.type === "submission" },
  review: { label: "Reviews", test: (h: Handoff) => h.type === "review" },
};
type Filter = keyof typeof FILTERS;

/** The project's folder name, as on disk (data/workspaces/<slug>-<id>). */
function folderName(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "project";
}

function Party({ name, department }: { name: string; department: string | null }) {
  return (
    <span className="min-w-0">
      <span className="font-medium">{name}</span>
      {department && <span className="text-muted-foreground"> · {department}</span>}
    </span>
  );
}

function HandoffList({ handoffs }: { handoffs: Handoff[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = handoffs.filter(FILTERS[filter].test);
  return (
    <SectionCard
      title="Who sent what"
      description="Every assignment, result and review passed between the client, the agents and the final submission."
      flush
    >
      <div className="border-b px-5 pb-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-auto flex-wrap">
            {(Object.keys(FILTERS) as Filter[]).map((f) => (
              <TabsTrigger key={f} value={f} className="gap-1.5">
                {FILTERS[f].label}
                <span className="text-xs text-muted-foreground tabular-nums">{handoffs.filter(FILTERS[f].test).length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {shown.length === 0 ? (
        <EmptyState title="Nothing here" hint="No messages of this kind for this project." />
      ) : (
        <ol className="divide-y">
          {shown.map((h, i) => {
            const type = TYPES[h.type] ?? TYPES.assignment;
            const Icon = type.icon;
            return (
              <li key={`${h.at}-${i}`} className={cn("flex gap-3 px-5 py-3 text-sm", h.type === "submission" && "bg-emerald-50/60")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", type.dot)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Party name={h.sender} department={h.sender_department} />
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-label="sent to" />
                    <Party name={h.recipient} department={h.recipient_department} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Icon className="size-3.5" /> {type.label}:
                    </span>
                    <span>{h.what}</span>
                    {h.status && <StatusBadge status={h.status} />}
                  </div>
                  {h.summary && <p className="mt-1 text-xs text-muted-foreground">{h.summary}</p>}
                  {h.files.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {h.files.map((f, j) => (
                        <span key={`${f}-${j}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          <FileText className="size-3" /> {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={h.at}>
                  {formatDate(h.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data, error, errorStatus, reload } = useApi<SubmissionDetail>(`/api/submissions/${id}`, 15000);

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/reports">
        <ArrowLeft /> All final reports
      </Link>
    </Button>
  );

  if (!data) {
    return (
      <>
        <PageHeader title="Final report" actions={back} />
        {error ? <PageError message={error} status={errorStatus} onRetry={reload} /> : <Skeleton className="h-96 rounded-xl" />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={data.title}
        subtitle={
          <>
            {data.client_name} ·{" "}
            <Link href={`/projects/${data.project_id}`} className="text-primary hover:underline">
              Open project
            </Link>
          </>
        }
        actions={back}
      />
      <SubmissionBanner submission={data.submission} clientName={data.client_name} />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Delivered files" value={data.deliverables.length} hint="report and QA-approved work" icon={<FileText />} />
        <StatCard label="Tokens used" value={formatNumber(data.tokens_used)} hint="across every agent" />
        <StatCard label="AI spend" value={formatUsd(data.spent_usd)} hint={`started ${formatDate(data.created_at)}`} />
      </div>

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Delivered work"
          description="The project's files in their folder structure. Click a file to preview it."
          flush
        >
          {data.deliverables.length === 0 ? (
            <EmptyState
              title="No files yet"
              hint={isStaff(user?.role) ? "QA-approved work appears here." : "Files are available once the final submission is made."}
              icon={<FileText className="size-5" />}
            />
          ) : (
            <FileTree files={data.deliverables} rootName={folderName(data.title)} />
          )}
        </SectionCard>
        {data.final_report ? (
          <FinalReportCard project={data} />
        ) : (
          <SectionCard title="Final report">
            <EmptyState title="Not written yet" hint="The CEO agent writes it once every department reports back." />
          </SectionCard>
        )}
        {isStaff(user?.role) && <HandoffList handoffs={data.handoffs} />}
      </div>
    </>
  );
}
