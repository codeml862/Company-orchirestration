"use client";

import {
  Bot,
  Building2,
  CheckCircle2,
  CircleAlert,
  Database,
  FolderKanban,
  Keyboard,
  LifeBuoy,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { isStaff, useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type Health = {
  status: string;
  database: string;
  llm_providers_configured: number;
  sandbox_backend: string;
  environment: string;
};

const STAFF_STEPS = [
  { title: "Add a client", text: "Create the client company and choose its autonomy level.", href: "/admin" },
  { title: "Create a project", text: "Describe the outcome, attach files and set a budget.", href: "/projects/new" },
  { title: "Watch it run", text: "Follow every task and decision live as the agents work.", href: "/operations" },
  { title: "Handle exceptions", text: "Decide what the autopilot escalates to you.", href: "/supervisor" },
];
const CLIENT_STEPS = [
  { title: "Start a project", text: "Tell us the outcome you need and attach any files.", href: "/projects/new" },
  { title: "Answer questions", text: "Agents may ask for details; reply from the project page.", href: "/portal" },
  { title: "Build your agents", text: "Add specialists that know your brand and rules.", href: "/portal/agents" },
  { title: "Get your delivery", text: "Download the deliverables once they pass review.", href: "/portal" },
];

const CONCEPTS = [
  {
    icon: Bot,
    title: "Agents",
    text: "A CEO, department heads and specialists. Work flows down the reporting lines; QA reviews every result.",
  },
  {
    icon: Building2,
    title: "Departments",
    text: "Teams of agents. Turn on ready-made teams or build your own from the Agents page.",
  },
  {
    icon: Rocket,
    title: "Autonomy",
    text: "Per client: supervised (people decide), autonomous (the autopilot decides routine approvals) or full.",
  },
  {
    icon: Wallet,
    title: "Budgets",
    text: "Each project and agent has limits. Work pauses for approval when a limit is reached.",
  },
];

const FAQ = [
  {
    q: "Why is nothing happening on my project?",
    a: "Agents need an LLM provider (AICO_LLM_PROVIDERS in backend/.env) and a running worker (python -m app.worker). The system status below shows whether a provider is configured.",
  },
  {
    q: "What does the autopilot decide on its own?",
    a: "For autonomous clients it answers unanswered questions after a timeout, extends budgets within limits and releases deliveries that pass the quality gate. Irreversible actions and production changes always go to a person.",
  },
  {
    q: "Can other companies see my agents or files?",
    a: "No. Client data and client-built agents are only ever used on that client's own projects.",
  },
  {
    q: "How do I add more departments?",
    a: "Admins can use Add department on the Agents or Organization page to switch on a ready-made team or create a custom one.",
  },
  {
    q: "I forgot my password.",
    a: "Ask an administrator to set a new one on the Clients & Users page, then change it on your Profile.",
  },
  {
    q: "Where do I change the main admin's login?",
    a: "In backend/.env (AICO_BOOTSTRAP_ADMIN_EMAIL and _PASSWORD). The API applies them the next time it starts.",
  },
];

const SHORTCUTS = [
  ["Ctrl / ⌘ + B", "Show or hide the sidebar"],
  ["Esc", "Close a dialog, or clear a search box"],
  ["Ctrl / ⌘ + scroll", "Zoom the Company Graph"],
  ["Drag", "Move around the Company Graph"],
];

function StatusRow({ ok, label, value }: { ok: boolean | null; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        {ok === null ? (
          <span className="size-4" />
        ) : ok ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <CircleAlert className="size-4 text-amber-500" />
        )}
        {label}
      </span>
      <span className={cn("text-muted-foreground", ok === false && "font-medium text-amber-700")}>{value}</span>
    </div>
  );
}

export default function HelpPage() {
  const { user } = useAuth();
  const { data: health, error, refreshing, updatedAt, reload } = useApi<Health>("/api/health", 30000);
  if (!user) return null;
  const staff = isStaff(user.role);
  const steps = staff ? STAFF_STEPS : CLIENT_STEPS;

  return (
    <>
      <PageHeader title="Help & support" subtitle="Get started, learn how Orchestria works, and check that everything is running." />
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <SectionCard title="Getting started">
          <ol className="grid gap-3 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.title}>
                <Link href={s.href} className="flex h-full gap-3 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="block text-sm text-muted-foreground">{s.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </SectionCard>

        <SectionCard title="How Orchestria works">
          <div className="grid gap-4 sm:grid-cols-2">
            {CONCEPTS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Frequently asked questions" flush>
          <div className="divide-y">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group px-5 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                  {q}
                  <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="space-y-6">
        <SectionCard
          title={<span className="flex items-center gap-2"><Database className="size-4" /> System status</span>}
          actions={
            <Button size="icon" variant="ghost" className="size-7" onClick={() => void reload()} disabled={refreshing} aria-label="Refresh status">
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </Button>
          }
        >
          {error && !health ? (
            <StatusRow ok={false} label="API" value="unreachable" />
          ) : !health ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : (
            <div className="divide-y">
              <StatusRow ok={health.status === "ok"} label="API" value={health.status === "ok" ? "running" : health.status} />
              <StatusRow ok={health.database === "ok"} label="Database" value={health.database === "ok" ? "connected" : health.database} />
              <StatusRow
                ok={health.llm_providers_configured > 0}
                label="LLM providers"
                value={health.llm_providers_configured ? `${health.llm_providers_configured} configured` : "none: agents can't work"}
              />
              {staff && (
                <>
                  <StatusRow ok={null} label="Code sandbox" value={health.sandbox_backend} />
                  <StatusRow ok={null} label="Environment" value={health.environment} />
                </>
              )}
            </div>
          )}
          {updatedAt && <p className="mt-2 text-xs text-muted-foreground">Checked {timeAgo(new Date(updatedAt).toISOString())}</p>}
        </SectionCard>

        <SectionCard title={<span className="flex items-center gap-2"><Keyboard className="size-4" /> Keyboard shortcuts</span>}>
          <dl className="grid gap-2 text-sm">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{what}</dt>
                <dd>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>

        <SectionCard title={<span className="flex items-center gap-2"><LifeBuoy className="size-4" /> Still stuck?</span>}>
          <p className="text-sm text-muted-foreground">
            {staff
              ? "Check Live Operations for errors, and the Supervisor Console for anything waiting on a person."
              : "Contact your account manager. Questions from agents appear on your project page."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={staff ? "/operations" : "/portal"}>
                <FolderKanban /> {staff ? "Live Operations" : "My Projects"}
              </Link>
            </Button>
            {staff && (
              <Button size="sm" variant="outline" asChild>
                <Link href="/supervisor">
                  <ShieldCheck /> Supervisor Console
                </Link>
              </Button>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
    </>
  );
}
