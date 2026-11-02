"use client";

import { Bot, Loader2, Lock, Pencil, Plus, ShieldCheck, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CompanyAgentDialog } from "@/components/agents/CompanyAgentDialog";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { patch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, CompanyAgents } from "@/lib/types";

export default function MyAgentsPage() {
  const { user } = useAuth();
  const isClient = user?.role === "client";
  const { data, error, errorStatus, refreshing, updatedAt, reload, setData } = useApi<CompanyAgents>("/api/company/agents", 15000);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function setActive(agent: Agent, active: boolean) {
    setToggling(agent.id);
    try {
      const updated = await patch<Agent>(`/api/company/agents/${agent.id}`, { is_active: active });
      setData((d) => (d ? { ...d, agents: d.agents.map((a) => (a.id === updated.id ? updated : a)) } : d));
      toast.success(active ? `${agent.name} is back to work` : `${agent.name} paused: it gets no new work`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the agent");
    } finally {
      setToggling(null);
    }
  }

  const header = (
    <PageHeader
      title="My agents"
      subtitle="Agents your company built. They join one of our teams, work only on your projects, and our QA reviews everything they produce."
      actions={
        <>
          <SyncStatus updatedAt={updatedAt} refreshing={refreshing} error={data ? error : null} onRefresh={reload} />
          {isClient && data && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus /> Create agent
            </Button>
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        )}
      </>
    );
  }

  const teamName = (agent: Agent) => data.departments.find((d) => d.id === agent.department_id)?.name ?? "Team";

  return (
    <>
      {header}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          [Lock, "Private", "Only your projects can use them; other companies never see them."],
          [ShieldCheck, "Reviewed", "Every result goes through our independent QA before you get it."],
          [Wrench, "Your rules", "You write the instructions and choose the tools and model."],
        ].map(([Icon, title, text]) => {
          const I = Icon as typeof Lock;
          return (
            <div key={title as string} className="flex gap-3 rounded-xl border bg-card p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <I className="size-4" />
              </span>
              <div>
                <div className="text-sm font-medium">{title as string}</div>
                <div className="text-xs text-muted-foreground">{text as string}</div>
              </div>
            </div>
          );
        })}
      </div>

      {data.agents.length === 0 ? (
        <Card>
          <EmptyState
            title="You haven't built an agent yet"
            icon={<Bot className="size-5" />}
            hint={
              isClient ? (
                <>
                  Create one with your own instructions, for example a writer that knows your brand voice.{" "}
                  <Button variant="link" className="h-auto p-0" onClick={() => setOpen(true)}>
                    Create your first agent
                  </Button>
                </>
              ) : (
                "Client companies create their agents from their portal."
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.agents.map((a) => (
            <Card key={a.id} className="gap-0 p-4">
              <div className="flex items-start gap-3">
                <AgentAvatar name={a.name} role={a.role_type} status={a.stats.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {teamName(a)} · {humanize(a.model_tier)} model
                  </div>
                </div>
                <StatusBadge status={a.stats.status} />
              </div>
              <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{a.description}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs">
                <div>
                  <div className="font-semibold tabular-nums">
                    {a.stats.succeeded}/{a.stats.executions}
                  </div>
                  <div className="text-muted-foreground">runs ok</div>
                </div>
                <div>
                  <div className="font-semibold tabular-nums">{formatNumber(a.stats.tokens)}</div>
                  <div className="text-muted-foreground">tokens</div>
                </div>
                <div>
                  <div className="font-semibold tabular-nums">{formatUsd(a.stats.cost_usd)}</div>
                  <div className="text-muted-foreground">cost</div>
                </div>
              </div>
              {isClient && (
                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                  <label className="flex items-center gap-2 text-sm">
                    {toggling === a.id && <Loader2 className="size-3.5 animate-spin" />}
                    <Switch
                      checked={a.is_active}
                      disabled={toggling === a.id}
                      onCheckedChange={(v) => void setActive(a, v)}
                      aria-label={`${a.name} active`}
                    />
                    {a.is_active ? "Active" : "Paused"}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(a);
                      setOpen(true);
                    }}
                  >
                    <Pencil /> Edit
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {isClient && (
        <CompanyAgentDialog
          open={open}
          onOpenChange={setOpen}
          agent={editing}
          options={data}
          onSaved={(saved) => {
            toast.success(editing ? `${saved.name} updated` : `${saved.name} is ready for your next project`);
            void reload();
          }}
        />
      )}
    </>
  );
}
