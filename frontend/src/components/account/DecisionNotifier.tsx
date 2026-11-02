"use client";

import { useEffect, useRef } from "react";

import { isStaff } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { usePreferences } from "@/lib/preferences";
import type { Approval, Project, User } from "@/lib/types";

const POLL_MS = 30000;

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Desktop notification when something new needs this person: a pending approval for staff, a
 * project waiting for their answer for clients. Opt-in on the Settings page; what already existed
 * when the page loaded is not announced.
 */
export function DecisionNotifier({ user }: { user: User }) {
  const [prefs] = usePreferences();
  const staff = isStaff(user.role);
  const enabled = prefs.notifyDecisions && notificationsSupported() && Notification.permission === "granted";
  const { data: approvals } = useApi<Approval[]>(enabled && staff ? "/api/approvals" : null, POLL_MS);
  const { data: projects } = useApi<Project[]>(enabled && !staff ? "/api/projects" : null, POLL_MS);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled) {
      seen.current = null;
      return;
    }
    const items = staff
      ? approvals?.map((a) => ({ id: a.id, title: a.title, href: "/supervisor" }))
      : projects
          ?.filter((p) => p.needs_client_input)
          .map((p) => ({ id: p.id, title: `${p.title} needs your answer`, href: `/projects/${p.id}` }));
    if (!items) return;
    if (seen.current) {
      for (const item of items.filter((i) => !seen.current!.has(i.id))) {
        const n = new Notification(staff ? "Decision needed" : "Your project needs you", { body: item.title, tag: item.id });
        n.onclick = () => {
          window.focus();
          window.location.href = item.href;
        };
      }
    }
    seen.current = new Set(items.map((i) => i.id));
  }, [enabled, staff, approvals, projects]);

  return null;
}
