"use client";

import Link from "next/link";

import { timeAgo } from "@/lib/format";
import type { AuditEvent } from "@/lib/types";

import { EmptyState, cn } from "./ui";

const DOT = { info: "bg-sky-400", warning: "bg-amber-400", error: "bg-rose-500" };

export function Timeline({
  events,
  showProjectLinks = false,
  onTaskClick,
}: {
  events: AuditEvent[];
  showProjectLinks?: boolean;
  onTaskClick?: (taskId: string) => void;
}) {
  if (!events.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white", DOT[e.severity] ?? DOT.info)} />
          <div className="text-sm text-slate-800">
            {onTaskClick && e.entity_type === "task" && e.entity_id ? (
              <button className="text-left hover:text-brand-700" onClick={() => onTaskClick(e.entity_id!)}>
                {e.message}
              </button>
            ) : (
              e.message
            )}
          </div>
          <div className="text-xs text-slate-500">
            {timeAgo(e.created_at)} · {e.action}
            {showProjectLinks && e.project_id && (
              <>
                {" · "}
                <Link className="text-brand-700 hover:underline" href={`/projects/${e.project_id}`}>
                  project
                </Link>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
