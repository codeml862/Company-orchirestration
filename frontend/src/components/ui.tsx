"use client";

import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { humanize, statusTone } from "@/lib/format";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "slate",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "slate" | "green" | "red" | "amber" | "violet" | "blue";
  icon?: React.ReactNode;
}) {
  const tones = {
    slate: "text-slate-900",
    green: "text-emerald-600",
    red: "text-rose-600",
    amber: "text-amber-600",
    violet: "text-violet-600",
    blue: "text-sky-600",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", tones[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const TONE_CLASSES = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: keyof typeof TONE_CLASSES }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <Badge tone={tone}>
      {(status === "running" || status === "working") && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
      )}
      {humanize(status)}
    </Badge>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", loading, className, children, ...props }: ButtonProps) {
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
    ghost: "text-slate-600 hover:bg-slate-100",
  };
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-sm" };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = "secondary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition",
        variant === "primary"
          ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700"
          : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </Link>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>;
}

export function EmptyState({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {hint && <div className="mt-1 max-w-md text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2.5 align-top text-slate-700", className)}>{children}</td>;
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = "max-w-3xl",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className={cn("relative flex h-full w-full flex-col bg-white shadow-xl", width)}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 text-base font-semibold text-slate-900">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500";

export function Bar({ value, max, tone = "bg-brand-500" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
