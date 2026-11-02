"use client";

import { Building2, CheckCircle2, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DepartmentIcon } from "@/components/shared/DepartmentIcon";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { FieldError, FormDialog, slugify } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { post } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { CatalogDepartment, Department } from "@/lib/types";

/**
 * Grow the company: switch on a ready-made catalog department with its whole team, or create a
 * custom department (which then needs a head agent before it can receive work).
 */
export function AddDepartmentDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (department: Department, kind: "catalog" | "custom") => void;
}) {
  const { data: catalog, error: catalogError, reload } = useApi<CatalogDepartment[]>(open ? "/api/departments/catalog" : null);
  const [tab, setTab] = useState("catalog");
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setKey("");
    setKeyEdited(false);
    setDescription("");
    setTouched(false);
    setError(null);
  }, [open]);

  async function enable(d: CatalogDepartment) {
    setAdding(d.key);
    try {
      const department = await post<Department>("/api/departments/enable", { key: d.key });
      toast.success(`${d.name} joined the company with ${d.agent_count} agents`);
      onAdded(department, "catalog");
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not add ${d.name}`);
    } finally {
      setAdding(null);
    }
  }

  const errors = {
    name: name.trim().length >= 2 ? null : "Name the department",
    key: /^[a-z][a-z0-9_]{1,63}$/.test(key) ? null : "Lower-case letters, digits and _; start with a letter",
  };
  const invalid = Object.values(errors).some(Boolean);

  async function createCustom(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const department = await post<Department>("/api/departments", {
        key,
        name: name.trim(),
        description: description.trim(),
      });
      toast.success(`${department.name} created. Add its head so it can receive work.`);
      onAdded(department, "custom");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the department");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={tab === "custom" ? createCustom : undefined}
      icon={<Building2 />}
      title="Add department"
      description="Bring in a ready-made team, or build a department of your own."
      footer={
        tab === "custom" ? (
          <>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Create department
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        )
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="w-full">
          <TabsTrigger value="catalog">Ready-made teams</TabsTrigger>
          <TabsTrigger value="custom">Custom department</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="grid gap-3">
          {catalogError && !catalog ? (
            <ErrorAlert message={catalogError} className="mb-0" />
          ) : !catalog ? (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </>
          ) : catalog.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="size-6 text-emerald-500" />
              Every catalog department is already part of the company.
            </div>
          ) : (
            catalog.map((d) => (
              <div key={d.key} className="flex items-start gap-3 rounded-xl border p-4">
                <DepartmentIcon department={d.key} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{d.name}</div>
                    <Button size="sm" type="button" disabled={adding !== null} onClick={() => void enable(d)}>
                      {adding === d.key ? <Loader2 className="animate-spin" /> : <Plus />}
                      Add {d.agent_count} agents
                    </Button>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {d.head && <span>Led by {d.head}</span>}
                    {Object.entries(d.roles).map(([role, n]) => (
                      <span key={role}>
                        {n} {humanize(role).toLowerCase()}
                        {n === 1 ? "" : "s"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="custom" className="grid gap-4">
          <ErrorAlert message={error} className="mb-0" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="dept-name">Name</Label>
              <Input
                id="dept-name"
                value={name}
                placeholder="e.g. Legal"
                aria-invalid={Boolean(touched && errors.name)}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyEdited) setKey(slugify(e.target.value));
                }}
              />
              <FieldError>{touched && errors.name}</FieldError>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dept-key">Key</Label>
              <Input
                id="dept-key"
                value={key}
                className="font-mono text-xs"
                aria-invalid={Boolean(touched && errors.key)}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyEdited(true);
                }}
              />
              {touched && errors.key ? (
                <FieldError>{errors.key}</FieldError>
              ) : (
                <p className="text-xs text-muted-foreground">Used by the planner; can&apos;t be changed later</p>
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dept-description">What it does</Label>
            <Textarea
              id="dept-description"
              className="min-h-20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contracts, compliance reviews and legal research for client projects."
            />
          </div>
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Next you&apos;ll add its head (a coordinator reporting to the CEO). The planner only sends work to departments
            that have one.
          </p>
        </TabsContent>
      </Tabs>
    </FormDialog>
  );
}
