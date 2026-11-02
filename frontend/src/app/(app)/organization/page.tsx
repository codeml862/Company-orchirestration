"use client";

import { Activity, Bot, Building2, ChevronDown, ChevronRight, Maximize2, Minimize2, Plus, Power, UserRoundSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AddDepartmentDialog } from "@/components/agents/AddDepartmentDialog";
import { AgentPanel } from "@/components/agents/AgentPanel";
import { type AgentPreset, CreateAgentDialog } from "@/components/agents/CreateAgentDialog";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchInput, matches } from "@/components/shared/SearchInput";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Department, OrgNode } from "@/lib/types";
import { cn } from "@/lib/utils";

type OrgChart = { roots: OrgNode[]; agent_count: number; department_count: number };
const STATUSES = ["all", "working", "idle", "inactive"] as const;
type StatusFilter = (typeof STATUSES)[number];

function flatten(nodes: OrgNode[], out: OrgNode[] = []) {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

/** Keep nodes that match, plus every ancestor of a match (so the reporting line stays visible). */
function prune(nodes: OrgNode[], keep: (n: OrgNode) => boolean): OrgNode[] {
  return nodes.flatMap((n) => {
    const children = prune(n.children, keep);
    return keep(n) || children.length ? [{ ...n, children }] : [];
  });
}

function parentIds(nodes: OrgNode[], out = new Set<string>()) {
  for (const n of nodes) {
    if (n.children.length) out.add(n.id);
    parentIds(n.children, out);
  }
  return out;
}

function Node({
  node,
  expanded,
  toggle,
  onSelect,
  highlight,
}: {
  node: OrgNode;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
  highlight: (n: OrgNode) => boolean;
}) {
  const open = expanded.has(node.id);
  const hit = highlight(node);
  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-lg border bg-card py-2 pr-3 pl-1.5 transition-colors hover:border-primary/30 hover:bg-muted/30",
          !node.is_active && "opacity-60",
          hit && "border-primary/40 bg-primary/5",
        )}
      >
        {node.children.length ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => toggle(node.id)}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={open}
          >
            {open ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : (
          <span className="w-7" />
        )}
        <button onClick={() => onSelect(node.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <AgentAvatar name={node.name} role={node.role_type} status={node.stats.status} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium group-hover:text-primary">{node.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {humanize(node.role_type)}
              {node.department_name ? ` · ${node.department_name}` : ""}
              {node.children.length ? ` · ${node.children.length} direct report${node.children.length === 1 ? "" : "s"}` : ""}
            </span>
          </span>
        </button>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {node.stats.queued_tasks > 0 && <ToneBadge tone="blue">{node.stats.queued_tasks} queued</ToneBadge>}
          {node.stats.running_tasks > 0 && <ToneBadge tone="violet">{node.stats.running_tasks} running</ToneBadge>}
          <StatusBadge status={node.stats.status} />
        </div>
      </div>
      {open && node.children.length > 0 && (
        <ul className="mt-1.5 ml-5 space-y-1.5 border-l pl-4">
          {node.children.map((child) => (
            <Node key={child.id} node={child} expanded={expanded} toggle={toggle} onSelect={onSelect} highlight={highlight} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrganizationPage() {
  const router = useRouter();
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const { data, error, errorStatus, refreshing, updatedAt, reload } = useApi<OrgChart>("/api/org-chart", 10000);
  // Only needed for the admin's "Create agent" form.
  const { data: agents, reload: reloadAgents } = useApi<Agent[]>(admin ? "/api/agents" : null);
  const { data: departmentList, reload: reloadDepartments } = useApi<Department[]>(admin ? "/api/departments" : null);
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState<AgentPreset | undefined>(undefined);
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const all = useMemo(() => flatten(data?.roots ?? []), [data]);
  const departments = useMemo(
    () =>
      [...new Map(all.filter((n) => n.department).map((n) => [n.department!, n.department_name ?? n.department!])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1]),
      ),
    [all],
  );
  const filtering = Boolean(query) || department !== "all" || status !== "all";
  const isMatch = (n: OrgNode) =>
    matches(query, n.name, n.key, n.department_name, humanize(n.role_type)) &&
    (department === "all" || n.department === department) &&
    (status === "all" || n.stats.status === status);
  const roots = filtering ? prune(data?.roots ?? [], isMatch) : (data?.roots ?? []);
  const matchCount = filtering ? all.filter(isMatch).length : all.length;

  const header = (
    <PageHeader
      title="Organization"
      subtitle={
        data
          ? `${data.agent_count} agents across ${data.department_count} departments. Select an agent for a quick look, or open its full profile.`
          : "The company hierarchy and reporting lines."
      }
      actions={
        <>
          <SyncStatus updatedAt={updatedAt} refreshing={refreshing} error={data ? error : null} onRefresh={reload} />
          {admin && (
            <>
              <Button size="sm" variant="outline" onClick={() => setAddingDepartment(true)}>
                <Building2 /> Add department
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setPreset(undefined);
                  setCreating(true);
                }}
              >
                <Plus /> Create agent
              </Button>
            </>
          )}
        </>
      }
    />
  );

  if (!data) {
    return (
      <>
        {header}
        {error ? (
          <PageError message={error} status={errorStatus} onRetry={reload} />
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" style={{ marginLeft: i ? 24 : 0 }} />
            ))}
          </div>
        )}
      </>
    );
  }

  // While filtering, open every branch that leads to a match; otherwise use the user's choice.
  const current = filtering ? parentIds(roots) : (expanded ?? new Set(data.roots.map((r) => r.id)));
  const toggle = (id: string) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  const working = all.filter((n) => n.stats.status === "working").length;
  const inactive = all.filter((n) => !n.is_active).length;
  const clearFilters = () => {
    setQuery("");
    setDepartment("all");
    setStatus("all");
  };

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Agents" value={data.agent_count} hint="in the hierarchy" icon={<Bot />} />
        <StatCard label="Working now" value={working} hint="running a task" tone="violet" icon={<Activity />} />
        <StatCard
          label="Inactive"
          value={inactive}
          hint={inactive ? "receive no new work" : "all agents active"}
          tone={inactive ? "amber" : "green"}
          icon={<Power />}
        />
        <StatCard label="Departments" value={data.department_count} icon={<Building2 />} tone="blue" />
      </div>

      <SectionCard className="mt-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search agents, keys or roles…" className="w-full sm:w-72" />
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-48" aria-label="Filter by department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map(([key, name]) => (
                <SelectItem key={key} value={key}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList>
              {STATUSES.map((s) => (
                <TabsTrigger key={s} value={s} className="px-2.5">
                  {humanize(s)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={filtering} onClick={() => setExpanded(parentIds(data.roots))}>
              <Maximize2 /> Expand all
            </Button>
            <Button size="sm" variant="outline" disabled={filtering} onClick={() => setExpanded(new Set())}>
              <Minimize2 /> Collapse
            </Button>
          </div>
        </div>
        {filtering && (
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            {matchCount} matching agent{matchCount === 1 ? "" : "s"} (managers shown for context)
            <Button variant="link" size="sm" className="h-auto p-0" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )}
        {roots.length === 0 ? (
          <EmptyState
            title="No agents match these filters"
            icon={<UserRoundSearch className="size-5" />}
            hint={
              <Button variant="link" className="h-auto p-0" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {roots.map((root) => (
              <Node
                key={root.id}
                node={root}
                expanded={current}
                toggle={toggle}
                onSelect={setSelected}
                highlight={(n) => filtering && isMatch(n)}
              />
            ))}
          </ul>
        )}
      </SectionCard>
      <AgentPanel agentId={selected} onClose={() => setSelected(null)} />
      {admin && agents && departmentList && (
        <>
          <CreateAgentDialog
            open={creating}
            onOpenChange={setCreating}
            agents={agents}
            departments={departmentList}
            preset={preset}
            onCreated={(agent) => {
              toast.success(`${agent.name} joined the company`, {
                action: { label: "Open", onClick: () => router.push(`/agents/${agent.id}`) },
              });
              void reload();
              void reloadAgents();
            }}
          />
          <AddDepartmentDialog
            open={addingDepartment}
            onOpenChange={setAddingDepartment}
            onAdded={(dept, kind) => {
              void reload();
              void reloadAgents();
              void reloadDepartments();
              if (kind === "custom") {
                setPreset({ department: dept.key, role: "coordinator", reportsTo: "ceo" });
                setCreating(true);
              }
            }}
          />
        </>
      )}
    </>
  );
}
