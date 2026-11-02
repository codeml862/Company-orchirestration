"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";

import { ClientProjectView } from "@/components/projects/ClientProjectView";
import { StaffProjectView } from "@/components/projects/StaffProjectView";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Loading } from "@/components/shared/Loading";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { isStaff, useAuth } from "@/lib/auth";
import { formatDate, formatNumber, formatUsd } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { progressOf } from "@/lib/project";
import type { Project } from "@/lib/types";

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: project, error, reload } = useApi<Project>(`/api/projects/${id}`, 10000);
  if (!project) return error ? <ErrorAlert message={error} /> : <Loading />;
  const { done, total } = progressOf(project);
  const staff = isStaff(user?.role);

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={project.status} />
            {staff && <span>{project.client_name}</span>}
            <span>· created {formatDate(project.created_at)}</span>
            {project.needs_client_input && <ToneBadge tone="amber">needs client input</ToneBadge>}
          </span>
        }
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={staff ? "/projects" : "/portal"}>
              <ArrowLeft /> Back
            </Link>
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Progress" value={`${done}/${total}`} hint="tasks approved" tone="green" />
        <StatCard
          label="AI spend"
          value={formatUsd(project.spent_usd)}
          hint={project.budget_usd ? `budget ${formatUsd(project.budget_usd)}` : "no budget cap"}
        />
        <StatCard label="Tokens" value={formatNumber(project.tokens_used)} />
        <StatCard label="Deadline" value={project.deadline ? formatDate(project.deadline) : "—"} />
      </div>
      {staff ? (
        <StaffProjectView project={project} reload={() => void reload()} />
      ) : (
        <ClientProjectView project={project} reload={() => void reload()} />
      )}
    </>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ProjectDetail />
    </Suspense>
  );
}
