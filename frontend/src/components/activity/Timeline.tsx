"use client";

import Link from "next/link";

import { EmptyState } from "@/components/shared/EmptyState";
import { timeAgo } from "@/lib/format";
import type { AuditEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

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
    <ol className="relative ml-1 space-y-3 border-l pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span
            className={cn("absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-card", DOT[e.severity] ?? DOT.info)}
          />
          <div className="text-sm">
            {onTaskClick && e.entity_type === "task" && e.entity_id ? (
              <button className="text-left hover:text-primary" onClick={() => onTaskClick(e.entity_id!)}>
                {e.message}
              </button>
            ) : (
              e.message
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {timeAgo(e.created_at)} · {e.action}
            {showProjectLinks && e.project_id && (
              <>
                {" · "}
                <Link className="text-primary hover:underline" href={`/projects/${e.project_id}`}>
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
