"use client";

import { useState } from "react";

import { JsonBlock } from "@/components/shared/JsonBlock";
import { ToneBadge } from "@/components/shared/StatusBadge";
import type { Execution } from "@/lib/types";

/** Step-by-step transcript of one agent execution: prompt, model replies, tool calls, validation. */
export function ExecutionLog({ execution, compact = false }: { execution: Execution; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  if (compact && !open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 text-xs font-medium text-primary hover:underline">
        Show transcript ({execution.transcript.length} steps)
      </button>
    );
  }
  return (
    <ol className="mt-2 space-y-2">
      {execution.transcript.map((step, i) => (
        <li key={i} className="rounded-lg border p-2 text-xs">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <ToneBadge tone={step.type === "tool" ? "violet" : step.type === "validation_failed" ? "red" : "blue"}>{step.type}</ToneBadge>
            {step.type === "llm" && (
              <span className="text-muted-foreground">
                {String(step.provider)}/{String(step.model)} · {String(step.prompt_tokens)}+{String(step.completion_tokens)} tokens ·{" "}
                {String(step.latency_ms)} ms
              </span>
            )}
            {step.type === "tool" && (
              <span className="text-muted-foreground">
                {String(step.tool)} · {step.ok ? "ok" : "error"} · {String(step.tool_call_id)}
              </span>
            )}
          </div>
          {step.type === "request" && <JsonBlock value={step.system_prompt} />}
          {step.type === "llm" && <JsonBlock value={step.response} />}
          {step.type === "tool" && <JsonBlock value={{ arguments: step.arguments, result: step.result }} />}
          {step.type === "validation_failed" && <JsonBlock value={step.errors} />}
        </li>
      ))}
    </ol>
  );
}
