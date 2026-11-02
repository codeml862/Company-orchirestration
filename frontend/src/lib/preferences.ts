"use client";

import { useCallback, useEffect, useState } from "react";

/** Per-device preferences (Settings page). Stored in localStorage, so they follow the browser, not the account. */
export interface Preferences {
  /** Where staff land after signing in. */
  startPage: string;
  sidebarCollapsed: boolean;
  /** Desktop notification when a decision (staff) or your input (client) is needed. */
  notifyDecisions: boolean;
}

export const START_PAGES = [
  { href: "/dashboard", label: "Executive Dashboard" },
  { href: "/operations", label: "Live Operations" },
  { href: "/supervisor", label: "Supervisor Console" },
  { href: "/projects", label: "Projects" },
  { href: "/graph", label: "Company Graph" },
];

const KEY = "orchestria.preferences";
const CHANGED = "orchestria:preferences";
export const DEFAULT_PREFERENCES: Preferences = { startPage: "/dashboard", sidebarCollapsed: false, notifyDecisions: false };

export function readPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored = { ...DEFAULT_PREFERENCES, ...JSON.parse(window.localStorage.getItem(KEY) ?? "{}") };
    if (!START_PAGES.some((p) => p.href === stored.startPage)) stored.startPage = DEFAULT_PREFERENCES.startPage;
    return stored;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writePreferences(change: Partial<Preferences>): Preferences {
  const next = { ...readPreferences(), ...change };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode): the change lasts for this page only
  }
  window.dispatchEvent(new Event(CHANGED));
  return next;
}

/** Current preferences, kept in sync across components and browser tabs. */
export function usePreferences(): [Preferences, (change: Partial<Preferences>) => void] {
  const [prefs, setPrefs] = useState<Preferences>(readPreferences);
  useEffect(() => {
    const sync = () => setPrefs(readPreferences());
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((change: Partial<Preferences>) => setPrefs(writePreferences(change)), []);
  return [prefs, update];
}
