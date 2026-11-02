"use client";

import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { post, upload } from "@/lib/api";
import { isStaff, useAuth } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Client, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRIORITIES = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Normal" },
  { value: 4, label: "Low" },
  { value: 5, label: "Whenever" },
];
// Same rules as the API (app/api/projects.py and app/schemas.py ProjectCreate).
const MAX_FILE_MB = 25;
const ACCEPTED = [
  "text/",
  "application/json",
  "application/pdf",
  "application/csv",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "image/png",
  "image/jpeg",
];
const MAX_DELIVERABLES = 20;

type Form = {
  client_id: string;
  title: string;
  request: string;
  deliverables: string[];
  priority: number;
  budget_usd: string;
  budget_tokens: string;
  deadline: string;
  start_now: boolean;
};

type Step = "idle" | "creating" | "uploading" | "starting";

function fileProblem(file: File): string | null {
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `larger than ${MAX_FILE_MB} MB`;
  if (!file.type) return null; // unknown type: the server decides
  if (!ACCEPTED.some((t) => file.type.startsWith(t))) return `type ${file.type} is not accepted`;
  return null;
}

function validate(f: Form, staff: boolean) {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (staff && !f.client_id) errors.client_id = "Choose the client this project is for";
  if (f.title.trim().length < 3) errors.title = "Give the project a title of at least 3 characters";
  else if (f.title.length > 300) errors.title = "Keep the title under 300 characters";
  if (f.request.trim().length < 10) errors.request = "Describe what you need in at least 10 characters";
  else if (f.request.length > 50_000) errors.request = "The request is too long (50,000 characters max)";
  if (f.budget_usd.trim() && (Number.isNaN(Number(f.budget_usd)) || Number(f.budget_usd) < 0)) {
    errors.budget_usd = "Enter 0 or more, or leave empty for no limit";
  }
  if (f.budget_tokens.trim() && (!Number.isInteger(Number(f.budget_tokens)) || Number(f.budget_tokens) < 1000)) {
    errors.budget_tokens = "At least 1,000 tokens, or leave empty";
  }
  if (f.deadline && new Date(f.deadline).getTime() < Date.now()) errors.deadline = "The deadline is in the past";
  return errors;
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function NewProjectPage() {
  const { user } = useAuth();
  const router = useRouter();
  const staff = isStaff(user?.role);
  const { data: clients, error: clientsError, reload: reloadClients } = useApi<Client[]>(staff ? "/api/clients" : null);
  const [form, setForm] = useState<Form>({
    client_id: "",
    title: "",
    request: "",
    deliverables: [""],
    priority: 3,
    budget_usd: "",
    budget_tokens: "",
    deadline: "",
    start_now: true,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [uploaded, setUploaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Set once the project exists, so a retry after a failed upload never creates a duplicate.
  const [draft, setDraft] = useState<Project | null>(null);

  const errors = validate(form, staff);
  const invalid = Object.keys(errors).length > 0;
  const busy = step !== "idle";
  const dirty = Boolean(form.title || form.request || files.length);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const show = (key: keyof Form) => (touched ? errors[key] : undefined);

  useEffect(() => {
    if (!dirty || draft) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draft]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const rejected = incoming.map((f) => [f, fileProblem(f)] as const).filter(([, problem]) => problem);
    rejected.forEach(([f, problem]) => toast.error(`${f.name}: ${problem}`));
    const accepted = incoming.filter((f) => !fileProblem(f));
    setFiles((current) => [...current, ...accepted.filter((f) => !current.some((c) => c.name === f.name && c.size === f.size))]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) {
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
    setError(null);
    let project = draft;
    try {
      if (!project) {
        setStep("creating");
        // Created without starting: files are attached first so agents see them from the beginning.
        project = await post<Project>("/api/projects", {
          title: form.title.trim(),
          request: form.request.trim(),
          requested_deliverables: form.deliverables.map((d) => d.trim()).filter(Boolean),
          client_id: staff ? form.client_id : null,
          priority: form.priority,
          budget_usd: form.budget_usd.trim() || null,
          budget_tokens: form.budget_tokens.trim() ? Number(form.budget_tokens) : null,
          deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
          submit: false,
        });
        setDraft(project);
      }
      setStep("uploading");
      for (let i = uploaded; i < files.length; i++) {
        await upload(project.id, files[i]).catch((err: unknown) => {
          throw new Error(`Uploading ${files[i].name} failed: ${err instanceof Error ? err.message : err}`);
        });
        setUploaded(i + 1);
      }
      if (form.start_now) {
        setStep("starting");
        await post(`/api/projects/${project.id}/submit`);
        toast.success("Project submitted: the CEO agent is analyzing it now");
      } else {
        toast.success("Project saved as a draft");
      }
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project");
      setStep("idle");
    }
  }

  const stepLabel = {
    idle: form.start_now ? "Submit project" : "Save draft",
    creating: "Creating project…",
    uploading: `Uploading files (${uploaded}/${files.length})…`,
    starting: "Starting work…",
  }[step];
  const deliverables = form.deliverables.filter((d) => d.trim());

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link href="/projects">
          <ArrowLeft /> Projects
        </Link>
      </Button>
      <PageHeader
        title="New project"
        subtitle="Describe the outcome you need. The CEO agent analyzes it, plans the work and staffs it with the right departments."
      />

      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {draft && error && (
            <ErrorAlert
              message={`${error}. The project was saved as a draft; submitting again only retries what's left.`}
              className="mb-0"
            />
          )}
          {!draft && <ErrorAlert message={error} className="mb-0" />}

          <SectionCard title="The brief">
            <div className="grid gap-5">
              {staff && (
                <Field
                  label="Client"
                  htmlFor="client_id"
                  error={show("client_id")}
                  hint={
                    clientsError ? (
                      <span className="text-destructive">
                        Couldn&apos;t load clients: {clientsError}{" "}
                        <button type="button" className="underline" onClick={() => void reloadClients()}>
                          Retry
                        </button>
                      </span>
                    ) : clients?.length === 0 ? (
                      <>
                        No clients yet.{" "}
                        <Link href="/admin" className="text-primary hover:underline">
                          Create one on the Clients &amp; Users page
                        </Link>
                        .
                      </>
                    ) : (
                      "The company this work is for. Its users will see the project in their portal."
                    )
                  }
                >
                  <Select value={form.client_id} onValueChange={(v) => set("client_id", v)} disabled={busy || !!draft}>
                    <SelectTrigger id="client_id" className="w-full" aria-invalid={Boolean(show("client_id"))}>
                      <SelectValue placeholder={clients ? "Select a client…" : "Loading clients…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {!c.allow_external_llm && <span className="text-xs text-muted-foreground"> · local models only</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Title" htmlFor="title" error={show("title")}>
                <Input
                  id="title"
                  value={form.title}
                  disabled={busy || !!draft}
                  placeholder="e.g. Launch landing page for the spring campaign"
                  aria-invalid={Boolean(show("title"))}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>
              <Field
                label="What do you need?"
                htmlFor="request"
                error={show("request")}
                hint={`${form.request.length.toLocaleString()} / 50,000 · business goal, requirements, constraints and audience. The more specific, the better.`}
              >
                <Textarea
                  id="request"
                  className="min-h-44"
                  value={form.request}
                  disabled={busy || !!draft}
                  placeholder="We need… It is for… It must… It must not…"
                  aria-invalid={Boolean(show("request"))}
                  onChange={(e) => set("request", e.target.value)}
                />
              </Field>
              <Field label="Expected deliverables" optional hint={`Up to ${MAX_DELIVERABLES}. Each one is checked in the final report.`}>
                <div className="space-y-2">
                  {form.deliverables.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={d}
                        disabled={busy || !!draft}
                        placeholder={i === 0 ? "e.g. Python module with tests" : "Another deliverable"}
                        aria-label={`Deliverable ${i + 1}`}
                        onChange={(e) => set("deliverables", form.deliverables.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      {form.deliverables.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy || !!draft}
                          onClick={() => set("deliverables", form.deliverables.filter((_, j) => j !== i))}
                          aria-label={`Remove deliverable ${i + 1}`}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  ))}
                  {form.deliverables.length < MAX_DELIVERABLES && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !!draft}
                      onClick={() => set("deliverables", [...form.deliverables, ""])}
                    >
                      <Plus /> Add deliverable
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Planning" description="Budgets pause work for a supervisor's approval when reached">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Priority" className="sm:col-span-2">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Priority">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={form.priority === p.value}
                      disabled={busy || !!draft}
                      onClick={() => set("priority", p.value)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
                        form.priority === p.value ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Deadline" htmlFor="deadline" optional error={show("deadline")}>
                <Input
                  id="deadline"
                  type="datetime-local"
                  value={form.deadline}
                  disabled={busy || !!draft}
                  aria-invalid={Boolean(show("deadline"))}
                  onChange={(e) => set("deadline", e.target.value)}
                />
              </Field>
              <Field label="AI budget (USD)" htmlFor="budget_usd" optional error={show("budget_usd")} hint="Empty means no limit">
                <Input
                  id="budget_usd"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.budget_usd}
                  disabled={busy || !!draft}
                  placeholder="No limit"
                  aria-invalid={Boolean(show("budget_usd"))}
                  onChange={(e) => set("budget_usd", e.target.value)}
                />
              </Field>
              <Field label="Token budget" htmlFor="budget_tokens" optional error={show("budget_tokens")} hint="Works without model prices">
                <Input
                  id="budget_tokens"
                  type="number"
                  min={1000}
                  step={1000}
                  value={form.budget_tokens}
                  disabled={busy || !!draft}
                  placeholder="No limit"
                  aria-invalid={Boolean(show("budget_tokens"))}
                  onChange={(e) => set("budget_tokens", e.target.value)}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Files" description="Requirements, data or examples the agents should use">
            <label
              htmlFor="files"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-muted/40",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <Upload className="size-6 text-muted-foreground" />
              <span className="mt-2 text-sm font-medium">Drop files here or click to browse</span>
              <span className="mt-1 text-xs text-muted-foreground">
                Text, CSV, JSON, PDF, Office documents, PNG or JPEG · up to {MAX_FILE_MB} MB each
              </span>
              <input
                id="files"
                type="file"
                multiple
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {files.length > 0 && (
              <ul className="mt-4 divide-y rounded-lg border">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    {i < uploaded ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    ) : step === "uploading" && i === uploaded ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {!f.type && (
                      <span className="flex items-center gap-1 text-xs text-amber-700" title="The browser couldn't tell the file type">
                        <TriangleAlert className="size-3" /> unknown type
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={busy || i < uploaded}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="gap-0 py-0">
            <div className="border-b px-5 py-4">
              <div className="text-sm font-semibold">Summary</div>
              <dl className="mt-3 space-y-2 text-sm">
                {[
                  ["Client", staff ? (clients?.find((c) => c.id === form.client_id)?.name ?? "—") : "Your company"],
                  ["Priority", PRIORITIES.find((p) => p.value === form.priority)?.label],
                  ["Deliverables", deliverables.length || "—"],
                  ["Files", files.length ? `${files.length} (${formatBytes(files.reduce((a, f) => a + f.size, 0))})` : "—"],
                  ["Budget", form.budget_usd ? `$${form.budget_usd}` : "No limit"],
                  ["Deadline", form.deadline ? new Date(form.deadline).toLocaleString() : "—"],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="space-y-3 border-b px-5 py-4 text-sm">
              <div className="font-semibold">What happens next</div>
              {[
                [Search, "The CEO agent analyzes the request and may ask clarifying questions."],
                [Bot, "Departments plan and execute the work; QA reviews every deliverable."],
                [ShieldCheck, "A human supervisor approves the final delivery before you receive it."],
              ].map(([Icon, text], i) => {
                const I = Icon as typeof Search;
                return (
                  <div key={i} className="flex gap-3 text-muted-foreground">
                    <I className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{text as string}</span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-3 px-5 py-4">
              <Label className="flex items-start gap-3 font-normal">
                <Switch checked={form.start_now} disabled={busy} onCheckedChange={(v) => set("start_now", v)} className="mt-0.5" />
                <span>
                  <span className="block font-medium">Start work immediately</span>
                  <span className="text-xs text-muted-foreground">Off: save as a draft and submit it later</span>
                </span>
              </Label>
              {touched && invalid && (
                <p className="text-xs text-destructive">
                  Fix {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? "" : "s"} to continue.
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {draft && !busy ? "Retry" : stepLabel}
              </Button>
              {draft && !busy && (
                <Button type="button" variant="outline" className="w-full" asChild>
                  <Link href={`/projects/${draft.id}`}>Open the draft instead</Link>
                </Button>
              )}
            </div>
          </Card>
        </div>
      </form>
    </>
  );
}
