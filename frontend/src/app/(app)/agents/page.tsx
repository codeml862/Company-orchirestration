"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge, Card, ErrorBanner, PageHeader, Spinner, StatusBadge, Table, Td, inputClass } from "@/components/ui";
import { formatNumber, formatPercent, formatUsd, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Agent, Department } from "@/lib/types";

export default function AgentsPage() {
  const { data: agents, error } = useApi<Agent[]>("/api/agents", 10000);
  const { data: departments } = useApi<Department[]>("/api/departments");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const deptName = useMemo(() => new Map(departments?.map((d) => [d.id, d.name]) ?? []), [departments]);
  const filtered = (agents ?? []).filter(
    (a) =>
      (!department || a.department_id === department) &&
      (!role || a.role_type === role) &&
      (!status || a.stats.status === status) &&
      (!search || `${a.name} ${a.key} ${a.description}`.toLowerCase().includes(search.toLowerCase())),
  );

  if (!agents) return error ? <ErrorBanner message={error} /> : <Spinner />;
  return (
    <>
      <PageHeader title="Agent Management" subtitle="Configure agents, tools, models and limits; inspect logs and performance." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <input className={`${inputClass} max-w-xs`} placeholder="Search agents…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={`${inputClass} max-w-[14rem]`} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departments?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select className={`${inputClass} max-w-[12rem]`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {["ceo", "director", "coordinator", "sub_coordinator", "specialist"].map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </select>
          <select className={`${inputClass} max-w-[10rem]`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {["working", "idle", "inactive"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <div className="ml-auto self-center text-sm text-slate-500">{filtered.length} agents</div>
        </div>
        <Table head={["Agent", "Department", "Role", "Status", "Tools", "Executions", "1st-pass QA", "Tokens", "Cost"]}>
          {filtered.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/agents/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                  {a.name}
                </Link>
                <div className="text-xs text-slate-500">{a.key}{a.customized && " · customized"}</div>
              </Td>
              <Td>{a.department_id ? deptName.get(a.department_id) : "—"}</Td>
              <Td>{humanize(a.role_type)}</Td>
              <Td>
                <StatusBadge status={a.stats.status} />
              </Td>
              <Td>
                <div className="flex max-w-[16rem] flex-wrap gap-1">
                  {a.allowed_tools.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              </Td>
              <Td className="tabular-nums">
                {a.stats.succeeded}/{a.stats.executions}
                {a.stats.failed > 0 && <span className="text-rose-600"> ({a.stats.failed} failed)</span>}
              </Td>
              <Td className="tabular-nums">
                {a.stats.reviews ? formatPercent(a.stats.first_pass_approvals / Math.max(1, a.stats.reviews)) : "—"}
              </Td>
              <Td className="tabular-nums">{formatNumber(a.stats.tokens)}</Td>
              <Td className="tabular-nums">{formatUsd(a.stats.cost_usd)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
