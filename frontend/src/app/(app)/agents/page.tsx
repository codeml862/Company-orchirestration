"use client";

import { Activity, Bot, Building2, Coins, Plus, UserRoundSearch, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AddDepartmentDialog } from "@/components/agents/AddDepartmentDialog";
import { type AgentPreset, CreateAgentDialog } from "@/components/agents/CreateAgentDialog";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { DepartmentIcon } from "@/components/shared/DepartmentIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchInput, matches } from "@/components/shared/SearchInput";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, ToneBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatPercent, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Client, Department } from "@/lib/types";

const ROLES = ["ceo", "director", "coordinator", "sub_coordinator", "specialist"];
const STATUSES = ["all", "working", "idle", "inactive"] as const;
type StatusFilter = (typeof STATUSES)[number];

function AgentCard({ agent, clientName }: { agent: Agent; clientName?: string }) {
  const s = agent.stats;
  return (
    <Link href={`/agents/${agent.id}`} className="group block focus-visible:outline-none">
      <Card className="h-full gap-0 p-4 transition group-hover:shadow-md group-hover:ring-primary/30 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <div className="flex items-start gap-3">
          <AgentAvatar name={agent.name} role={agent.role_type} status={s.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium group-hover:text-primary">{agent.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{humanize(agent.role_type)}</span>
              {clientName && <ToneBadge tone="blue">{clientName}</ToneBadge>}
              {agent.customized && !clientName && <ToneBadge tone="amber">Custom</ToneBadge>}
            </div>
          </div>
          <StatusBadge status={s.status} />
        </div>
        <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{agent.description || "No description."}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs">
          <div>
            <div className="font-semibold tabular-nums">
              {s.succeeded}/{s.executions}
            </div>
            <div className="text-muted-foreground">runs ok</div>
          </div>
          <div>
            <div className="font-semibold tabular-nums">{formatPercent(s.reviews ? s.first_pass_approvals / s.reviews : null)}</div>
            <div className="text-muted-foreground">1st-pass QA</div>
          </div>
          <div>
            <div className="font-semibold tabular-nums">{formatNumber(s.tokens)}</div>
            <div className="text-muted-foreground">tokens</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wrench className="size-3" />
          {agent.allowed_tools.length ? `${agent.allowed_tools.length} tool${agent.allowed_tools.length === 1 ? "" : "s"}` : "No tools"}
          <span className="ml-auto">{humanize(agent.model_override ?? agent.model_tier)}</span>
        </div>
      </Card>
    </Link>
  );
}

export default function AgentsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const { data: agents, error, errorStatus, refreshing, updatedAt, reload } = useApi<Agent[]>("/api/agents", 10000);
  const { data: departments, reload: reloadDepartments } = useApi<Department[]>("/api/departments");
  const { data: clients } = useApi<Client[]>("/api/clients");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [role, setRole] = useState("all");
  const [owner, setOwner] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState<AgentPreset | undefined>(undefined);
  const [addingDepartment, setAddingDepartment] = useState(false);

  const clientName = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c.name])), [clients]);
  const filtered = (agents ?? []).filter(
    (a) =>
      (department === "all" || a.department_id === department) &&
      (role === "all" || a.role_type === role) &&
      (status === "all" || a.stats.status === status) &&
      (owner === "all" || (owner === "client" ? Boolean(a.client_id) : !a.client_id)) &&
      matches(query, a.name, a.key, a.description, a.client_id ? clientName.get(a.client_id) : null),
  );
  const groups = (departments ?? [])
    .map((d) => ({ department: d, agents: filtered.filter((a) => a.department_id === d.id) }))
    .filter((g) => g.agents.length > 0);
  const filtering = Boolean(query) || department !== "all" || role !== "all" || owner !== "all" || status !== "all";
  const clearFilters = () => {
    setQuery("");
    setDepartment("all");
    setRole("all");
    setOwner("all");
    setStatus("all");
  };

  const header = (
    <PageHeader
      title="Agents"
      subtitle="Every agent in the company: its role, tools, model and how well it performs."
      actions={
        <>
          <SyncStatus updatedAt={updatedAt} refreshing={refreshing} error={agents ? error : null} onRefresh={reload} />
          {admin && (
            <>
              <Button size="sm" variant="outline" onClick={() => setAddingDepartment(true)}>
                <Building2 /> Add department
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setPreset(department !== "all" ? { department: departments?.find((d) => d.id === department)?.key } : undefined);
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

  if (!agents) {
    return (
      <>
        {header}
        {error ? (
          <PageError message={error} status={errorStatus} onRetry={reload} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        )}
      </>
    );
  }

  const working = agents.filter((a) => a.stats.status === "working").length;
  const clientBuilt = agents.filter((a) => a.client_id).length;

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Agents"
          value={`${agents.filter((a) => a.is_active).length} / ${agents.length}`}
          hint="active / total"
          icon={<Bot />}
        />
        <StatCard label="Working now" value={working} hint="running a task" tone="violet" icon={<Activity />} />
        <StatCard
          label="Built by clients"
          value={clientBuilt}
          hint="private to their company"
          tone="blue"
          icon={<Users />}
        />
        <StatCard
          label="Spend to date"
          value={formatUsd(agents.reduce((sum, a) => sum + a.stats.cost_usd, 0))}
          hint={`${formatNumber(agents.reduce((sum, a) => sum + a.stats.tokens, 0))} tokens`}
          tone="green"
          icon={<Coins />}
        />
      </div>

      <Card className="mt-6 gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search agents…" className="w-full sm:w-64" />
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-44" aria-label="Filter by department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-40" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {humanize(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-40" aria-label="Filter by owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              <SelectItem value="company">Company agents</SelectItem>
              <SelectItem value="client">Client-built</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList>
              {STATUSES.map((s) => (
                <TabsTrigger key={s} value={s} className="px-2.5">
                  {humanize(s)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {agents.length} agents
            {filtering && (
              <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </span>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            title="No agents match these filters"
            icon={<UserRoundSearch className="size-5" />}
            hint={
              <Button variant="link" className="h-auto p-0" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map(({ department: d, agents: team }) => (
            <section key={d.id}>
              <div className="mb-3 flex items-center gap-3">
                <DepartmentIcon department={d.key} className="size-8 rounded-lg [&_svg]:size-4" />
                <h2 className="font-semibold">{d.name}</h2>
                <span className="text-sm text-muted-foreground">{team.length}</span>
                {admin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      setPreset({ department: d.key });
                      setCreating(true);
                    }}
                  >
                    <Plus /> Add agent
                  </Button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {team.map((a) => (
                  <AgentCard key={a.id} agent={a} clientName={a.client_id ? clientName.get(a.client_id) ?? "Client" : undefined} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {admin && departments && (
        <>
          <CreateAgentDialog
            open={creating}
            onOpenChange={setCreating}
            agents={agents}
            departments={departments}
            preset={preset}
            onCreated={(agent) => {
              toast.success(`${agent.name} joined the company`, {
                action: { label: "Open", onClick: () => router.push(`/agents/${agent.id}`) },
              });
              void reload();
            }}
          />
          <AddDepartmentDialog
            open={addingDepartment}
            onOpenChange={setAddingDepartment}
            onAdded={(dept, kind) => {
              void reloadDepartments();
              void reload();
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
