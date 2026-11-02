"use client";

import { Bot, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { FieldError, FormDialog, FormSection, slugify } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { post } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Department } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLES = [
  { value: "director", label: "Director", hint: "Leads a department, reports to the CEO" },
  { value: "coordinator", label: "Coordinator", hint: "Plans and splits a department's work" },
  { value: "sub_coordinator", label: "Sub-coordinator", hint: "Leads a team inside a department" },
  { value: "specialist", label: "Specialist", hint: "Does the hands-on work" },
] as const;
type Role = (typeof ROLES)[number]["value"];
const TIERS = ["fast", "standard", "strong"] as const;

export type AgentPreset = { department?: string; role?: Role; reportsTo?: string };

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Admin form for a new company agent anywhere in the hierarchy (POST /api/agents). */
export function CreateAgentDialog({
  open,
  onOpenChange,
  agents,
  departments,
  preset,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  departments: Department[];
  preset?: AgentPreset;
  onCreated: (agent: Agent) => void;
}) {
  const { data: tools } = useApi<{ name: string; description: string }[]>(open ? "/api/tools" : null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState(preset?.department ?? "");
  const [role, setRole] = useState<Role>(preset?.role ?? "specialist");
  const [reportsTo, setReportsTo] = useState(preset?.reportsTo ?? "");
  const [description, setDescription] = useState("");
  const [responsibilities, setResponsibilities] = useState("");
  const [instructions, setInstructions] = useState("");
  const [allowed, setAllowed] = useState<string[]>(["project_files.read"]);
  const [tier, setTier] = useState<(typeof TIERS)[number]>("standard");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the dialog opens, honoring the preset (e.g. "add a head to this new department").
  useEffect(() => {
    if (!open) return;
    setName("");
    setDepartment(preset?.department ?? "");
    setRole(preset?.role ?? "specialist");
    setReportsTo(preset?.reportsTo ?? "");
    setDescription("");
    setResponsibilities("");
    setInstructions("");
    setAllowed(["project_files.read"]);
    setTier((preset?.role ?? "specialist") === "specialist" ? "standard" : "strong");
    setTouched(false);
    setError(null);
  }, [open, preset]);

  const dept = departments.find((d) => d.key === department);
  // Same rules as the API: managers are active company agents in this department (or the CEO), never specialists.
  const managers = useMemo(
    () =>
      agents.filter(
        (a) =>
          !a.client_id &&
          a.is_active &&
          a.role_type !== "specialist" &&
          (a.role_type === "ceo" ? role !== "specialist" : Boolean(dept) && a.department_id === dept?.id),
      ),
    [agents, dept, role],
  );
  useEffect(() => {
    if (managers.length && !managers.some((m) => m.key === reportsTo)) setReportsTo(managers[0].key);
    if (!managers.length) setReportsTo("");
  }, [managers, reportsTo]);

  const errors = {
    name: name.trim().length >= 2 ? null : "Give the agent a name",
    department: department ? null : "Choose a department",
    reportsTo: reportsTo
      ? null
      : role === "specialist"
        ? "This department has no coordinator yet; add one first"
        : "Choose who this agent reports to",
    description: description.trim().length >= 10 ? null : "Describe the agent in a sentence",
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const agent = await post<Agent>("/api/agents", {
        name: name.trim(),
        department_key: department,
        role_type: role,
        reports_to_key: reportsTo,
        description: description.trim(),
        responsibilities: lines(responsibilities),
        system_instructions: instructions.trim(),
        allowed_tools: allowed,
        model_tier: tier,
      });
      onCreated(agent);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      icon={<Bot />}
      title="Create agent"
      description="A new member of the company. It receives work through its manager."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Create agent
          </Button>
        </>
      }
    >
      <ErrorAlert message={error} className="mb-0" />

      <FormSection title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Contract Review Agent"
              aria-invalid={Boolean(show("name"))}
              autoFocus
            />
            {show("name") ? (
              <FieldError>{show("name")}</FieldError>
            ) : (
              <p className="text-xs text-muted-foreground">Key: {slugify(name) || "…"}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-department">Department</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger id="agent-department" className="w-full" aria-invalid={Boolean(show("department"))}>
                <SelectValue placeholder="Choose a department…" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{show("department")}</FieldError>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-description">What it does</Label>
          <Input
            id="agent-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Reviews contracts for risky clauses and summarizes them."
            aria-invalid={Boolean(show("description"))}
          />
          <FieldError>{show("description")}</FieldError>
        </div>
      </FormSection>

      <FormSection title="Place in the company">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Role">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={role === r.value}
              onClick={() => setRole(r.value)}
              className={cn(
                "rounded-lg border p-2.5 text-left transition-colors",
                role === r.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
              )}
            >
              <span className="block text-sm font-medium">{r.label}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">{r.hint}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-manager">Reports to</Label>
          <Select value={reportsTo} onValueChange={setReportsTo} disabled={!managers.length}>
            <SelectTrigger id="agent-manager" className="w-full" aria-invalid={Boolean(show("reportsTo"))}>
              <SelectValue placeholder={department ? "No eligible manager" : "Choose a department first"} />
            </SelectTrigger>
            <SelectContent>
              {managers.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.name} · {humanize(m.role_type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{show("reportsTo")}</FieldError>
        </div>
      </FormSection>

      <FormSection title="Instructions">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-responsibilities">Responsibilities</Label>
            <Textarea
              id="agent-responsibilities"
              className="min-h-24"
              value={responsibilities}
              onChange={(e) => setResponsibilities(e.target.value)}
              placeholder={"One per line\nFlag unlimited liability clauses"}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-instructions">System instructions</Label>
            <Textarea
              id="agent-instructions"
              className="min-h-24 font-mono text-xs"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="How it should work, what to avoid, what to escalate."
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Tools & model">
        {!tools ? (
          <p className="text-xs text-muted-foreground">Loading tools…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tools.map((t) => (
              <Label
                key={t.name}
                className="flex items-start gap-2.5 rounded-lg border p-2.5 font-normal has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5"
              >
                <Checkbox
                  checked={allowed.includes(t.name)}
                  onCheckedChange={() =>
                    setAllowed(allowed.includes(t.name) ? allowed.filter((x) => x !== t.name) : [...allowed, t.name])
                  }
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                </span>
              </Label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Model tier</span>
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tier === t}
              onClick={() => setTier(t)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                tier === t ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              {humanize(t)}
            </button>
          ))}
        </div>
      </FormSection>
    </FormDialog>
  );
}
