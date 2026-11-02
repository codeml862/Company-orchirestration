"use client";

import { useState } from "react";

import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { post } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Approval, ClientTask, Project } from "@/lib/types";

import { FilesCard } from "./FilesCard";
import { FinalReportCard } from "./FinalReportCard";

const ORDER = ["analyze", "plan", "execute", "final_report"];

function FeedbackCard({ project, reload }: { project: Project; reload: () => void }) {
  const [score, setScore] = useState("5");
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await post(`/api/projects/${project.id}/feedback`, { score: Number(score), comment: comment || null });
      setSent(true);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="How did we do?">
      {project.satisfaction_score || sent ? (
        <div className="text-sm text-muted-foreground">Thank you for your feedback.</div>
      ) : (
        <div className="space-y-3">
          <Select value={score} onValueChange={setScore}>
            <SelectTrigger className="w-32" aria-label="Score">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["5", "4", "3", "2", "1"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s} / 5
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea placeholder="Comments" value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button disabled={busy} onClick={send}>
            Send feedback
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

export function ClientProjectView({ project, reload }: { project: Project; reload: () => void }) {
  const { data: tasks } = useApi<ClientTask[]>(`/api/projects/${project.id}/tasks`, 10000);
  const { data: questions, reload: reloadQuestions } = useApi<Approval[]>(`/api/approvals?project_id=${project.id}`, 10000);
  const done = tasks?.filter((t) => t.status === "approved").length ?? 0;
  const ordered = (tasks ?? []).slice().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const completed = project.status === "completed";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {questions && questions.length > 0 && (
          <SectionCard title="The team needs your input">
            <div className="space-y-3">
              {questions.map((q) => (
                <ApprovalCard
                  key={q.id}
                  approval={q}
                  onDecided={() => {
                    void reloadQuestions();
                    reload();
                  }}
                />
              ))}
            </div>
          </SectionCard>
        )}
        <SectionCard title="Progress">
          <div className="mb-4">
            <ProgressBar value={done} max={tasks?.length ?? 0} tone="green" />
            <div className="mt-1 text-xs text-muted-foreground">
              {done} of {tasks?.length ?? 0} work items completed
            </div>
          </div>
          <ul className="divide-y">
            {ordered.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div>{t.title}</div>
                  <div className="text-xs text-muted-foreground">{t.department ?? "Executive"}</div>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        </SectionCard>
        {completed && <FinalReportCard project={project} />}
        {completed && <FeedbackCard project={project} reload={reload} />}
      </div>
      <div className="space-y-6">
        <SectionCard title="Your request">
          <p className="whitespace-pre-wrap text-sm">{project.request}</p>
        </SectionCard>
        <FilesCard project={project} canUpload={!["completed", "cancelled"].includes(project.status)} onUploaded={reload} />
      </div>
    </div>
  );
}
