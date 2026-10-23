"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { API_URL, api, getToken } from "./api";
import type { AuditEvent } from "./types";

/** Fetch JSON from the API, optionally refreshing on an interval. */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api<T>(path);
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    void load();
    if (!refreshMs) return;
    const timer = setInterval(() => void load(), refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  return { data, error, loading, reload: load, setData };
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
