"use client";

import { FileQuestion, Lock, RefreshCw, ServerCrash, TriangleAlert, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Re-render every few seconds so relative times stay current. */
function useTick(ms = 5000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

/**
 * Freshness of a page's data, for the page header: when it last refreshed, a manual refresh button,
 * and a warning (with retry) when the latest refresh failed and older data is still on screen.
 */
export function SyncStatus({
  updatedAt,
  refreshing,
  error,
  onRefresh,
}: {
  updatedAt: number | null;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  useTick();
  const failed = Boolean(error);
  return (
    <div
      className={cn(
        "flex h-8 items-center gap-1 rounded-lg border pr-1 pl-2.5 text-xs",
        failed ? "border-amber-200 bg-amber-50 text-amber-800" : "bg-card text-muted-foreground",
      )}
      title={error ?? undefined}
    >
      {failed ? (
        <>
          <TriangleAlert className="size-3.5" />
          <span className="max-w-56 truncate">
            Couldn&apos;t refresh{updatedAt ? ` · showing data from ${ago(updatedAt)}` : ""}
          </span>
        </>
      ) : (
        <span>{updatedAt ? `Updated ${ago(updatedAt)}` : "Loading…"}</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={failed ? "Retry" : "Refresh"}
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
      </Button>
    </div>
  );
}

const KINDS = {
  network: { icon: WifiOff, title: "Can't reach the server" },
  forbidden: { icon: Lock, title: "You don't have access" },
  missing: { icon: FileQuestion, title: "Not found" },
  server: { icon: ServerCrash, title: "Something went wrong on our side" },
  other: { icon: TriangleAlert, title: "This page couldn't load" },
};

function kindOf(status: number | null | undefined): keyof typeof KINDS {
  if (status === 0) return "network";
  if (status === 403) return "forbidden";
  if (status === 404) return "missing";
  if (status && status >= 500) return "server";
  return "other";
}

/** Full-page error for when a page has no data to show at all. Retry is offered unless it cannot help. */
export function PageError({
  message,
  status,
  onRetry,
  className,
}: {
  message: string;
  status?: number | null;
  onRetry?: () => void;
  className?: string;
}) {
  const kind = kindOf(status);
  const { icon: Icon, title } = KINDS[kind];
  const retryable = onRetry && kind !== "forbidden" && kind !== "missing";
  return (
    <Card className={cn("items-center px-6 py-14 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
        <Icon className="size-5" />
      </div>
      <div className="mt-4 text-base font-semibold">{title}</div>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {retryable && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </Card>
  );
}
