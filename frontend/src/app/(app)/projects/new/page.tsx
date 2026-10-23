"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Card, ErrorBanner, Field, PageHeader, inputClass } from "@/components/ui";
import { post, upload } from "@/lib/api";
import { isStaff, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Client, Project } from "@/lib/types";

export default function NewProjectPage() {
  const { user } = useAuth();
  const router = useRouter();
  const staff = isStaff(user?.role);
  const { data: clients } = useApi<Client[]>(staff ? "/api/clients" : null);
  const [form, setForm] = useState({
    title: "",
    request: "",
    deliverables: "",
    client_id: "",
    priority: 3,
    budget_usd: "",
    deadline: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string | number) => setForm({ ...form, [key]: value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Create first without starting, attach files, then submit, so agents see the files from the start.
      const project = await post<Project>("/api/projects", {
        title: form.title,
        request: form.request,
        requested_deliverables: form.deliverables.split("\n").map((d) => d.trim()).filter(Boolean),
        client_id: staff ? form.client_id || null : null,
        priority: Number(form.priority),
        budget_usd: form.budget_usd ? form.budget_usd : null,
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        submit: false,
      });
      for (const file of files) await upload(project.id, file);
      await post(`/api/projects/${project.id}/submit`);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project");
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New project" subtitle="Describe the outcome you need. The CEO agent will analyze it, plan the work and staff it." />
      <Card className="max-w-3xl">
        <ErrorBanner message={error} />
        <form onSubmit={submit} className="space-y-4">
          {staff && (
            <Field label="Client">
              <select className={inputClass} value={form.client_id} onChange={(e) => set("client_id", e.target.value)} required>
                <option value="">Select a client…</option>
                {clients?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Title">
            <input className={inputClass} value={form.title} onChange={(e) => set("title", e.target.value)} minLength={3} required />
          </Field>
          <Field label="What do you need?" hint="Business objective, requirements, constraints, audience. The more specific, the better.">
            <textarea className={`${inputClass} h-40`} value={form.request} onChange={(e) => set("request", e.target.value)} minLength={10} required />
          </Field>
          <Field label="Expected deliverables" hint="One per line, e.g. 'Python module with tests', 'Market report (PDF-ready markdown)'.">
            <textarea className={`${inputClass} h-20`} value={form.deliverables} onChange={(e) => set("deliverables", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Priority">
              <select className={inputClass} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                <option value={1}>1 · Highest</option>
                <option value={2}>2 · High</option>
                <option value={3}>3 · Normal</option>
                <option value={4}>4 · Low</option>
                <option value={5}>5 · Lowest</option>
              </select>
            </Field>
            <Field label="AI budget (USD)" hint="Work pauses for approval when reached.">
              <input className={inputClass} type="number" min={0} step="0.01" value={form.budget_usd} onChange={(e) => set("budget_usd", e.target.value)} />
            </Field>
            <Field label="Deadline">
              <input className={inputClass} type="datetime-local" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </Field>
          </div>
          <Field label="Files" hint="Requirements, data or examples the agents should use (text, CSV, JSON, PDF, images; max 25 MB each).">
            <input type="file" multiple className="text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Submit project
          </Button>
        </form>
      </Card>
    </>
  );
}
