"use client";

import { Bot, Building2, Loader2, Lock, Pencil, Plus, Rocket, ShieldCheck, UserCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { SearchInput, matches } from "@/components/shared/SearchInput";
import { SectionCard } from "@/components/shared/SectionCard";
import { ToneBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { patch, post } from "@/lib/api";
import { type Tone, formatDate } from "@/lib/format";
import type { AutonomyLevel, Client, User } from "@/lib/types";
import { cn } from "@/lib/utils";

export const AUTONOMY: Record<AutonomyLevel, { label: string; tone: Tone; icon: typeof Bot; short: string; description: string }> = {
  supervised: {
    label: "Supervised",
    tone: "gray",
    icon: UserCheck,
    short: "People decide",
    description: "A person decides every approval: budgets, client questions, deliveries and actions.",
  },
  autonomous: {
    label: "Autonomous",
    tone: "violet",
    icon: Bot,
    short: "Autopilot decides routine work",
    description:
      "The autopilot extends budgets within limits, answers unanswered questions after a timeout and releases deliveries that pass the quality gate. External actions go to a person.",
  },
  full: {
    label: "Full autonomy",
    tone: "green",
    icon: Rocket,
    short: "Autopilot decides almost everything",
    description:
      "Like autonomous, and the autopilot also approves external actions, spending and hiring. Irreversible actions and production changes still go to a person.",
  },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function ClientForm({
  client,
  canSetAutonomy,
  onSaved,
  onCancel,
}: {
  client: Client | null;
  canSetAutonomy: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.contact_email ?? "");
  const [retention, setRetention] = useState(String(client?.data_retention_days ?? 365));
  const [external, setExternal] = useState(client?.allow_external_llm ?? false);
  // New clients get the server's AICO_DEFAULT_AUTONOMY_LEVEL unless a level is picked.
  const [autonomy, setAutonomy] = useState<AutonomyLevel | null>(client?.autonomy_level ?? null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const days = Number(retention);
  const errors = {
    name: name.trim() ? null : "Enter the company name",
    email: email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "Enter a valid email address" : null,
    retention: Number.isInteger(days) && days >= 1 && days <= 3650 ? null : "Between 1 and 3,650 days",
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);
  const selected = autonomy ? AUTONOMY[autonomy] : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      contact_email: email.trim() || null,
      allow_external_llm: external,
      data_retention_days: days,
      // Only supervisors and admins may set it; others leave it out entirely.
      ...(canSetAutonomy && autonomy ? { autonomy_level: autonomy } : {}),
    };
    try {
      if (client) await patch<Client>(`/api/clients/${client.id}`, body);
      else await post<Client>("/api/clients", body);
      toast.success(client ? `${body.name} updated` : `${body.name} created`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the client");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-h-[calc(100svh-4rem)] flex-col">
      <DialogHeader className="border-b px-6 py-4">
        <DialogTitle className="flex items-center gap-2 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="size-4" />
          </span>
          {client ? `Edit ${client.name}` : "New client company"}
        </DialogTitle>
        <DialogDescription>Its users only ever see their own projects and agents.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-6 overflow-y-auto px-6 py-5">
        <ErrorAlert message={error} className="mb-0" />

        <Section title="Company">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="client-name">Company name</Label>
              <Input
                id="client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(show("name"))}
                placeholder="Acme Inc."
                autoFocus
              />
              {show("name") && <p className="text-xs text-destructive">{show("name")}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-email">
                Contact email <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(show("email"))}
                placeholder="ops@acme.com"
              />
              {show("email") && <p className="text-xs text-destructive">{show("email")}</p>}
            </div>
          </div>
        </Section>

        <Section title="Data & privacy">
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="client-retention">Keep finished projects</Label>
              <div className="relative">
                <Input
                  id="client-retention"
                  type="number"
                  min={1}
                  max={3650}
                  value={retention}
                  onChange={(e) => setRetention(e.target.value)}
                  aria-invalid={Boolean(show("retention"))}
                  className="pr-12"
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                  days
                </span>
              </div>
              {show("retention") && <p className="text-xs text-destructive">{show("retention")}</p>}
            </div>
            <label
              htmlFor="client-external"
              className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 hover:bg-muted/40"
            >
              <span className="grid gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {external ? <ShieldCheck className="size-3.5 text-sky-600" /> : <Lock className="size-3.5" />}
                  {external ? "Hosted LLMs allowed" : "Local models only"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {external
                    ? "Work may be sent to external providers such as OpenAI or Groq."
                    : "Data stays on providers marked external: false (e.g. Ollama)."}
                </span>
              </span>
              <Switch id="client-external" checked={external} onCheckedChange={setExternal} />
            </label>
          </div>
        </Section>

        <Section title="Autonomy">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Autonomy level">
            {(Object.keys(AUTONOMY) as AutonomyLevel[]).map((level) => {
              const { label, short, icon: Icon } = AUTONOMY[level];
              const on = autonomy === level;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!canSetAutonomy}
                  onClick={() => setAutonomy(level)}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md",
                      on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{short}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {!canSetAutonomy
              ? "Only a supervisor or admin can change the autonomy level."
              : selected
                ? selected.description
                : "Not chosen: the server default applies (autonomous unless configured otherwise)."}
          </p>
        </Section>
      </div>

      {/* The dialog has no padding here, so cancel the footer's built-in negative margins. */}
      <DialogFooter className="mx-0 mb-0 shrink-0 border-t px-6 py-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {client ? "Save changes" : "Create client"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ClientsPanel({
  clients,
  users,
  canSetAutonomy,
  onChanged,
}: {
  clients: Client[];
  /** Only available to admins; used to show how many users each client has. */
  users: User[] | null;
  /** Supervisors and admins decide how much the autopilot may do for a client. */
  canSetAutonomy: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; client: Client | null }>({ open: false, client: null });
  const close = () => setDialog((d) => ({ ...d, open: false }));
  const userCount = (clientId: string) => users?.filter((u) => u.client_id === clientId).length ?? 0;
  const shown = clients.filter((c) => matches(search, c.name, c.contact_email));

  return (
    <SectionCard
      flush
      title={`${clients.length} client${clients.length === 1 ? "" : "s"}`}
      actions={
        <Button size="sm" onClick={() => setDialog({ open: true, client: null })}>
          <Plus /> New client
        </Button>
      }
    >
      <div className="border-b p-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clients…" className="max-w-xs" />
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={clients.length ? "No clients match your search" : "No clients yet"}
          hint={clients.length ? undefined : "Create a client company, then add its users so they can submit projects."}
          icon={<Building2 className="size-5" />}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Client</TableHead>
              <TableHead>Autonomy</TableHead>
              <TableHead>Model policy</TableHead>
              <TableHead>Retention</TableHead>
              {users && <TableHead>Users</TableHead>}
              <TableHead>Created</TableHead>
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="pl-5">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.contact_email ?? "No contact email"}</div>
                </TableCell>
                <TableCell>
                  <ToneBadge tone={AUTONOMY[c.autonomy_level]?.tone ?? "gray"}>
                    {AUTONOMY[c.autonomy_level]?.label ?? c.autonomy_level}
                  </ToneBadge>
                </TableCell>
                <TableCell>
                  {c.allow_external_llm ? (
                    <ToneBadge tone="blue">External LLMs allowed</ToneBadge>
                  ) : (
                    <ToneBadge tone="gray">Local models only</ToneBadge>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{c.data_retention_days} days</TableCell>
                {users && <TableCell className="tabular-nums">{userCount(c.id)}</TableCell>}
                <TableCell className="text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                <TableCell className="pr-5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, client: c })}>
                    <Pencil /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={dialog.open} onOpenChange={(open) => !open && close()}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <ClientForm
            key={dialog.client?.id ?? "new"}
            client={dialog.client}
            canSetAutonomy={canSetAutonomy}
            onCancel={close}
            onSaved={() => {
              close();
              onChanged();
            }}
          />
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
