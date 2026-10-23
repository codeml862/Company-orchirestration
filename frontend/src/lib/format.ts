export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function formatUsd(value: number | string | null | undefined, digits = 4): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? digits : 2)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat().format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ACRONYMS: Record<string, string> = { ceo: "CEO", qa: "QA", hr: "HR", llm: "LLM" };

export function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => ACRONYMS[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type Tone = "gray" | "blue" | "green" | "amber" | "red" | "violet";

const STATUS_TONES: Record<string, Tone> = {
  pending: "gray",
  ready: "blue",
  running: "violet",
  in_review: "amber",
  awaiting_approval: "amber",
  blocked: "red",
  approved: "green",
  failed: "red",
  cancelled: "gray",
  submitted: "blue",
  in_progress: "violet",
  paused: "gray",
  completed: "green",
  rejected: "red",
  working: "violet",
  idle: "gray",
  inactive: "gray",
  succeeded: "green",
  info: "blue",
  warning: "amber",
  error: "red",
};

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? "gray";
}
