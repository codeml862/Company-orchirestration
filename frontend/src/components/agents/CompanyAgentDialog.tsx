"use client";

import { Bot, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { FieldError, FormDialog, FormSection } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { patch, post } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { Agent, CompanyAgents } from "@/lib/types";
import { cn } from "@/lib/utils";

const TIERS = [
  { value: "fast", label: "Fast", hint: "Cheapest, for simple work" },
  { value: "standard", label: "Standard", hint: "Balanced quality and cost" },
  { value: "strong", label: "Strong", hint: "Best quality, highest cost" },
] as const;

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Create or edit an agent a client company owns (POST/PATCH /api/company/agents). */
export function CompanyAgentDialog({
  open,
  onOpenChange,
  agent,
  options,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null: create a new agent. */
  agent: Agent | null;
  options: Pick<CompanyAgents, "departments" | "tools">;
  onSaved: (agent: Agent) => void;
}) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [description, setDescription] = useState("");
  const [responsibilities, setResponsibilities] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [tier, setTier] = useState("standard");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? "");
    setDepartment(agent ? (options.departments.find((d) => d.id === agent.department_id)?.key ?? "") : "");
    setDescription(agent?.description ?? "");
    setResponsibilities(agent?.responsibilities.join("\n") ?? "");
    setInstructions(agent?.system_instructions ?? "");
    setTools(agent?.allowed_tools ?? ["project_files.read"]);
    setTier(agent?.model_tier ?? "standard");
    setTouched(false);
    setError(null);
  }, [open, agent, options.departments]);

  // Same limits as the API (CompanyAgentCreate).
  const errors = {
    name: name.trim().length >= 2 ? null : "Give your agent a name",
    department: agent || department ? null : "Choose the team your agent joins",
    description: description.trim().length >= 10 ? null : "Describe what it does in at least 10 characters",
    instructions:
      instructions.trim().length >= 20 ? null : "Write at least 20 characters of instructions: how it should work",
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      description: description.trim(),
      responsibilities: lines(responsibilities),
      system_instructions: instructions.trim(),
      allowed_tools: tools,
      model_tier: tier,
    };
    try {
      const saved = agent
        ? await patch<Agent>(`/api/company/agents/${agent.id}`, body)
        : await post<Agent>("/api/company/agents", { ...body, department_key: department });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the agent");
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
      title={agent ? `Edit ${agent.name}` : "Create your own agent"}
      description="It works only on your company's projects, inside the team you choose. Our QA reviews everything it produces."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {agent ? "Save changes" : "Create agent"}
          </Button>
        </>
      }
    >
      <ErrorAlert message={error} className="mb-0" />

      <FormSection title="About your agent">
        <div className="grid gap-1.5">
          <Label htmlFor="ca-name">Name</Label>
          <Input
            id="ca-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Brand Voice Writer"
            aria-invalid={Boolean(show("name"))}
            autoFocus
          />
          <FieldError>{show("name")}</FieldError>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ca-description">What it does</Label>
          <Input
            id="ca-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Writes marketing copy in our brand voice."
            aria-invalid={Boolean(show("description"))}
          />
          <FieldError>{show("description")}</FieldError>
        </div>
      </FormSection>

      {!agent && (
        <FormSection title="Team">
          {options.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team can take new agents right now.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Team">
              {options.departments.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  role="radio"
                  aria-checked={department === d.key}
                  onClick={() => setDepartment(d.key)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    department === d.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                  )}
                >
                  <span className="block text-sm font-medium">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">Reports to {d.head}</span>
                </button>
              ))}
            </div>
          )}
          <FieldError>{show("department")}</FieldError>
        </FormSection>
      )}

      <FormSection title="How it works">
        <div className="grid gap-1.5">
          <Label htmlFor="ca-instructions">Instructions</Label>
          <Textarea
            id="ca-instructions"
            className="min-h-28"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Follow our brand guide in the project files. Keep sentences short. Never promise prices."
            aria-invalid={Boolean(show("instructions"))}
          />
          <FieldError>{show("instructions")}</FieldError>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ca-responsibilities">
            Responsibilities <span className="font-normal text-muted-foreground">(optional, one per line)</span>
          </Label>
          <Textarea
            id="ca-responsibilities"
            className="min-h-20"
            value={responsibilities}
            onChange={(e) => setResponsibilities(e.target.value)}
          />
        </div>
      </FormSection>

      <FormSection title="Tools & quality">
        <div className="grid gap-2 sm:grid-cols-2">
          {options.tools.map((t) => (
            <Label
              key={t.name}
              className="flex items-start gap-2.5 rounded-lg border p-2.5 font-normal has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5"
            >
              <Checkbox
                checked={tools.includes(t.name)}
                onCheckedChange={() => setTools(tools.includes(t.name) ? tools.filter((x) => x !== t.name) : [...tools, t.name])}
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </span>
            </Label>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Model quality">
          {TIERS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={tier === t.value}
              onClick={() => setTier(t.value)}
              className={cn(
                "rounded-lg border p-2.5 text-left transition-colors",
                tier === t.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
              )}
            >
              <span className="block text-sm font-medium">{humanize(t.label)}</span>
              <span className="block text-[11px] text-muted-foreground">{t.hint}</span>
            </button>
          ))}
        </div>
      </FormSection>
    </FormDialog>
  );
}
