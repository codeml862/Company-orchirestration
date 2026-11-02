import { SectionCard } from "@/components/shared/SectionCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import type { Project } from "@/lib/types";

const OUTCOME_STATUS: Record<string, string> = { met: "approved", not_met: "failed", partially_met: "in_review" };

export function FinalReportCard({ project }: { project: Pick<Project, "final_report"> }) {
  const report = project.final_report;
  if (!report) return null;
  return (
    <SectionCard
      title="Final report"
      actions={
        <ToneBadge tone={report.objective_met ? "green" : "amber"}>
          {report.objective_met ? "Objective met" : "Objective not fully met"}
        </ToneBadge>
      }
    >
      <div className="space-y-4 text-sm">
        <p>{report.executive_summary}</p>
        <ul className="space-y-2">
          {report.outcomes.map((o) => (
            <li key={o.outcome} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={OUTCOME_STATUS[o.status] ?? "in_review"} />
                <span className="font-medium">{o.outcome}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{o.evidence}</div>
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer font-medium text-primary">Client deliverable document</summary>
          <pre className="prose-report mt-3 whitespace-pre-wrap rounded-lg bg-muted/60 p-4 font-sans text-sm">
            {report.final_deliverable_markdown}
          </pre>
        </details>
      </div>
    </SectionCard>
  );
}
