"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { JsonBlock } from "@/components/shared/JsonBlock";
import { ToneBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { post } from "@/lib/api";
import { type Tone, humanize, timeAgo } from "@/lib/format";
import type { Approval } from "@/lib/types";

const KIND_TONE: Record<string, Tone> = {
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
  const autopilot = approval.details.autopilot as { decision: string; reason: string } | undefined;

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
    <Card className="gap-0 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={KIND_TONE[approval.kind] ?? "gray"}>{humanize(approval.kind)}</ToneBadge>
        <span className="text-xs text-muted-foreground">{timeAgo(approval.created_at)}</span>
        {showProject && (
          <Link href={`/projects/${approval.project_id}`} className="text-xs text-primary hover:underline">
            Open project
          </Link>
        )}
      </div>
      <div className="mt-2 text-sm font-medium">{approval.title}</div>
      {autopilot?.decision === "escalated" && approval.status === "pending" && (
        <div className="mt-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Bot className="mt-px size-3.5 shrink-0" />
          <span>
            <span className="font-medium">The autopilot handed this to you:</span> {autopilot.reason}
          </span>
        </div>
      )}
      {isQuestion ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      ) : (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <div className="mt-2">
            <JsonBlock value={approval.details} />
          </div>
        </details>
      )}
      {approval.status === "pending" && canDecide ? (
        <div className="mt-3 space-y-2">
          <Textarea
            className="min-h-16"
            placeholder={isQuestion ? "Your answer" : "Note (optional; for a rejected final delivery this is the revision feedback)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || (isQuestion && !note.trim())} onClick={() => decide(true)}>
              {isQuestion ? "Send answer" : "Approve"}
            </Button>
            <Button size="sm" variant={isQuestion ? "outline" : "destructive"} disabled={busy} onClick={() => decide(false)}>
              {isQuestion ? "Proceed without answer" : "Reject"}
            </Button>
          </div>
        </div>
      ) : (
        approval.status !== "pending" && (
          <div className="mt-2 text-xs text-muted-foreground">
            {humanize(approval.status)} {approval.decision_note && `— ${approval.decision_note}`}
          </div>
        )
      )}
    </Card>
  );
}
