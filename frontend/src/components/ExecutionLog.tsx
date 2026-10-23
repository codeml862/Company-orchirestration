"use client";

import { useState } from "react";

import type { Execution } from "@/lib/types";

import { Badge, JsonBlock } from "./ui";

/** Step-by-step transcript of one agent execution: prompt, model replies, tool calls, validation. */
export function ExecutionLog({ execution, compact = false }: { execution: Execution; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  if (compact && !open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
        Show transcript ({execution.transcript.length} steps)
      </button>
    );
  }
  return (
    <ol className="mt-2 space-y-2">
      {execution.transcript.map((step, i) => (
        <li key={i} className="rounded-lg border border-slate-200 p-2 text-xs">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={step.type === "tool" ? "violet" : step.type === "validation_failed" ? "red" : "blue"}>{step.type}</Badge>
            {step.type === "llm" && (
              <span className="text-slate-500">
                {String(step.provider)}/{String(step.model)} · {String(step.prompt_tokens)}+{String(step.completion_tokens)} tokens ·{" "}
                {String(step.latency_ms)} ms
              </span>
            )}
            {step.type === "tool" && (
              <span className="text-slate-500">
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
