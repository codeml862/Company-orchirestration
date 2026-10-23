"use client";

import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";

import { AgentPanel } from "@/components/AgentPanel";
import { Badge, Button, Card, ErrorBanner, PageHeader, Spinner, StatusBadge, cn } from "@/components/ui";
import { humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { OrgNode } from "@/lib/types";

const ROLE_STYLE: Record<string, string> = {
  ceo: "border-l-slate-900",
  director: "border-l-indigo-600",
  coordinator: "border-l-indigo-500",
  sub_coordinator: "border-l-sky-500",
  specialist: "border-l-slate-300",
};

function collectIds(node: OrgNode, out: Set<string>) {
  if (node.children.length) out.add(node.id);
  node.children.forEach((c) => collectIds(c, out));
}

function Node({
  node,
  depth,
  expanded,
  toggle,
  onSelect,
}: {
  node: OrgNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const open = expanded.has(node.id);
  const working = node.stats.running_tasks;
  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-lg border border-l-4 border-slate-200 bg-white px-3 py-2 shadow-sm",
          ROLE_STYLE[node.role_type],
          !node.is_active && "opacity-50",
        )}
        style={{ marginLeft: depth * 24 }}
      >
        {node.children.length ? (
          <button onClick={() => toggle(node.id)} className="rounded p-0.5 text-slate-500 hover:bg-slate-100" aria-label="Toggle">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button onClick={() => onSelect(node.id)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium text-slate-900 group-hover:text-brand-700">{node.name}</div>
          <div className="truncate text-xs text-slate-500">
            {humanize(node.role_type)}
            {node.department_name ? ` · ${node.department_name}` : ""}
            {node.children.length ? ` · ${node.children.length} direct report(s)` : ""}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {node.stats.queued_tasks > 0 && <Badge tone="blue">{node.stats.queued_tasks} queued</Badge>}
          {working > 0 && <Badge tone="violet">{working} running</Badge>}
          <StatusBadge status={node.stats.status} />
        </div>
      </div>
      {open && node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrganizationPage() {
  const { data, error } = useApi<{ roots: OrgNode[]; agent_count: number; department_count: number }>("/api/org-chart", 10000);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const current = expanded ?? new Set(data.roots.map((r) => r.id));
  const toggle = (id: string) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  const expandAll = () => {
    const all = new Set<string>();
    data.roots.forEach((r) => collectIds(r, all));
    setExpanded(all);
  };

  return (
    <>
      <PageHeader
        title="Organization"
        subtitle={`${data.agent_count} agents across ${data.department_count} departments. Select an agent to inspect its role, instructions and assignments.`}
        actions={
          <>
            <Button size="sm" onClick={expandAll}>
              <Maximize2 className="h-3.5 w-3.5" /> Expand all
            </Button>
            <Button size="sm" onClick={() => setExpanded(new Set(data.roots.map((r) => r.id)))}>
              <Minimize2 className="h-3.5 w-3.5" /> Collapse
            </Button>
          </>
        }
      />
      <Card>
        <ul className="space-y-2">
          {data.roots.map((root) => (
            <Node key={root.id} node={root} depth={0} expanded={current} toggle={toggle} onSelect={setSelected} />
          ))}
        </ul>
      </Card>
      <AgentPanel agentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
