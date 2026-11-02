import { CheckCircle2, Clock, Hourglass, RotateCcw } from "lucide-react";

import { ToneBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/format";
import type { Submission } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATES = {
  submitted: { label: "Final submission submitted", short: "Submitted", tone: "green", icon: CheckCircle2 },
  awaiting_release: { label: "Final submission awaiting release", short: "Awaiting release", tone: "amber", icon: Clock },
  returned: { label: "Final submission sent back for revision", short: "Returned", tone: "red", icon: RotateCcw },
  not_ready: { label: "Final submission not ready yet", short: "In progress", tone: "gray", icon: Hourglass },
} as const;

export function SubmissionBadge({ submission }: { submission: Submission }) {
  const state = STATES[submission.state];
  return <ToneBadge tone={state.tone}>{state.short}</ToneBadge>;
}

/** The headline status of a project's final delivery. */
export function SubmissionBanner({ submission, clientName }: { submission: Submission; clientName: string }) {
  const state = STATES[submission.state];
  const Icon = state.icon;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4",
        state.tone === "green" && "border-emerald-200 bg-emerald-50 text-emerald-900",
        state.tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900",
        state.tone === "red" && "border-rose-200 bg-rose-50 text-rose-900",
        state.tone === "gray" && "border-slate-200 bg-slate-50 text-slate-800",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 text-sm">
        <div className="text-base font-semibold">{state.label}</div>
        {submission.state === "submitted" && (
          <div className="mt-0.5">
            Delivered to {clientName}
            {submission.submitted_at && ` on ${formatDate(submission.submitted_at)}`}
            {submission.released_by && `, released by ${submission.released_by}`}.
          </div>
        )}
        {submission.note && <div className="mt-1 opacity-80">{submission.note}</div>}
      </div>
    </div>
  );
}
