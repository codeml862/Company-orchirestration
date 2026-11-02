"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { API_URL, ApiError, api, getToken } from "./api";
import type { AuditEvent } from "./types";

/**
 * Fetch JSON from the API, optionally refreshing on an interval.
 *
 * A failed refresh keeps the last good `data` and sets `error`, so pages can show stale data with a
 * warning instead of going blank. Polling pauses while the tab is hidden and catches up when it is
 * shown again. Responses for a path the caller has since moved away from are ignored.
 */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const currentPath = useRef(path);
  currentPath.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    setRefreshing(true);
    try {
      const result = await api<T>(path);
      if (currentPath.current !== path) return;
      setData(result);
      setError(null);
      setErrorStatus(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (currentPath.current !== path) return;
      setError(e instanceof Error ? e.message : String(e));
      setErrorStatus(e instanceof ApiError ? e.status : null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    void load();
    if (!refreshMs) return;
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => visible() && void load(), refreshMs);
    const onVisibility = () => visible() && void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, refreshMs]);

  return { data, error, errorStatus, loading, refreshing, updatedAt, reload: load, setData };
}

/**
 * Subscribe to the live audit stream (Server-Sent Events). Keeps the newest `max` events and
 * calls `onEvent` for each one, so pages can refresh the data an event affects.
 */
export function useLiveEvents(options: { projectId?: string; max?: number; onEvent?: (e: AuditEvent) => void } = {}) {
  const { projectId, max = 200 } = options;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const onEvent = useRef(options.onEvent);
  onEvent.current = options.onEvent;

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    const token = getToken();
    if (!token) return;
    const query = projectId ? `&project_id=${projectId}` : "";

    api<AuditEvent[]>(`/api/events?limit=${max}${query}`)
      .then((initial) => {
        if (cancelled) return;
        setEvents(initial.slice().reverse());
        const after = initial.length ? initial[initial.length - 1].id : 0;
        source = new EventSource(
          `${API_URL}/api/events/stream?token=${encodeURIComponent(token)}&after_id=${after}${query}`,
        );
        source.onopen = () => setConnected(true);
        source.onerror = () => setConnected(false);
        source.addEventListener("audit", (message) => {
          const event = JSON.parse((message as MessageEvent).data) as AuditEvent;
          setEvents((current) => [event, ...current].slice(0, max));
          onEvent.current?.(event);
        });
      })
      .catch(() => setConnected(false));

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [projectId, max]);

  return { events, connected };
}
