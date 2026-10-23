"use client";

import Link from "next/link";
import { useState } from "react";

import { post } from "@/lib/api";
import { humanize, timeAgo } from "@/lib/format";
import type { Approval } from "@/lib/types";

import { Badge, Button, JsonBlock, inputClass } from "./ui";

const KIND_TONE: Record<string, "amber" | "red" | "blue" | "violet" | "green"> = {
  clarification: "blue",
  budget_overrun: "red",
  final_delivery: "green",
  external_action: "amber",
  spend: "red",
  hiring_decision: "amber",
  production_change: "red",
  irreversible: "red",
};

/** One human decision: shows what the agent asks for and records approve / reject with a note. */
export function ApprovalCard({
  approval,
  onDecided,
  canDecide = true,
  showProject = false,
}: {
  approval: Approval;
  onDecided: () => void;
  canDecide?: boolean;
  showProject?: boolean;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isQuestion = approval.kind === "clarification";
  const questions = (approval.details.questions as string[] | undefined) ?? [];

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/approvals/${approval.id}/decide`, { approve, note: note || null });
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={KIND_TONE[approval.kind] ?? "gray"}>{humanize(approval.kind)}</Badge>
        <span className="text-xs text-slate-500">{timeAgo(approval.created_at)}</span>
        {showProject && (
          <Link href={`/projects/${approval.project_id}`} className="text-xs text-brand-700 hover:underline">
            Open project
          </Link>
        )}
      </div>
      <div className="mt-2 text-sm font-medium text-slate-900">{approval.title}</div>
      {isQuestion ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      ) : (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-slate-500">Details</summary>
          <div className="mt-2">
            <JsonBlock value={approval.details} />
          </div>
        </details>
      )}
      {approval.status === "pending" && canDecide ? (
        <div className="mt-3 space-y-2">
          <textarea
            className={`${inputClass} h-16`}
            placeholder={isQuestion ? "Your answer" : "Note (optional; for a rejected final delivery this is the revision feedback)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <div className="text-xs text-rose-600">{error}</div>}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={() => decide(true)} disabled={isQuestion && !note.trim()}>
              {isQuestion ? "Send answer" : "Approve"}
            </Button>
            <Button size="sm" variant={isQuestion ? "secondary" : "danger"} loading={busy} onClick={() => decide(false)}>
              {isQuestion ? "Proceed without answer" : "Reject"}
            </Button>
          </div>
        </div>
      ) : (
        approval.status !== "pending" && (
          <div className="mt-2 text-xs text-slate-500">
            {humanize(approval.status)} {approval.decision_note && `— ${approval.decision_note}`}
          </div>
        )
      )}
    </div>
  );
}
