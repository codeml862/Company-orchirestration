"use client";

import { Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { initials } from "@/components/shared/AgentAvatar";
import { humanize } from "@/lib/format";
import type { OrgNode } from "@/lib/types";
import { cn } from "@/lib/utils";

export const DEPARTMENT_COLORS: Record<string, string> = {
  executive: "#4f46e5",
  operations: "#8b5cf6",
  technology: "#0ea5e9",
  hr: "#ec4899",
  marketing: "#f97316",
  sales: "#10b981",
  finance: "#f59e0b",
  support: "#14b8a6",
  research: "#a855f7",
};
export const colorOf = (department: string | null) => DEPARTMENT_COLORS[department ?? ""] ?? "#64748b";

// Every node is the agent's profile avatar, large enough to read at a glance.
const RADIUS: Record<string, number> = { ceo: 42, director: 34, coordinator: 33, sub_coordinator: 29, specialist: 24 };
// Each team (a lead and the agents reporting to it) gets its own color.
const TEAM_PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444",
  "#84cc16", "#f97316", "#06b6d4", "#d946ef", "#22c55e", "#e11d48", "#3b82f6", "#a855f7",
];
const CEO_COLOR = "#312e81";
const STATUS_COLOR: Record<string, string> = { working: "#8b5cf6", idle: "#10b981", inactive: "#94a3b8" };
const LINK = {
  reports: { length: 120, strength: 0.25 },
  team: { length: 80, strength: 0.06 },
  works: { length: 150, strength: 0.04 },
};
type LinkKind = keyof typeof LINK;

export type CollaborationLink = { source: string; target: string; weight: number };
type SimNode = {
  id: string;
  node: OrgNode;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  pinned: boolean;
};
type Flow = { from: SimNode; to: SimNode; delay: number };
type SimLink = { source: SimNode; target: SimNode; kind: LinkKind; weight: number };

function flatten(nodes: OrgNode[], parent: OrgNode | null, out: { node: OrgNode; parent: OrgNode | null; depth: number }[], depth = 0) {
  for (const n of nodes) {
    out.push({ node: n, parent, depth });
    flatten(n.children, n, out, depth + 1);
  }
  return out;
}

/** Nodes start on rings by depth, each department in its own sector, so the simulation settles quickly. */
function buildGraph(roots: OrgNode[], collaboration: CollaborationLink[]) {
  const entries = flatten(roots, null, []);
  const departments = [...new Set(entries.map((e) => e.node.department ?? ""))].filter((d) => d && d !== "executive");
  // A lead colors its own team; an individual contributor takes its lead's color.
  const teamColor = new Map<string, string>();
  const colorFor = (team: string) => {
    if (!teamColor.has(team)) teamColor.set(team, TEAM_PALETTE[teamColor.size % TEAM_PALETTE.length]);
    return teamColor.get(team)!;
  };
  const nodes = new Map<string, SimNode>();
  entries.forEach(({ node, parent, depth }, i) => {
    const sector = departments.indexOf(node.department ?? "");
    const angle = sector >= 0 ? (sector / Math.max(departments.length, 1)) * Math.PI * 2 + (i % 7) * 0.12 : i;
    const dist = depth * 170 + (i % 5) * 12;
    const leadsTeam = node.children.length > 0 || !parent || parent.role_type === "ceo";
    const color = node.role_type === "ceo" ? CEO_COLOR : colorFor(leadsTeam ? node.id : parent.id);
    nodes.set(node.id, {
      id: node.id,
      node,
      color,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
      r: RADIUS[node.role_type] ?? 9,
      pinned: false,
    });
  });
  const links: SimLink[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, kind: LinkKind, weight = 1) => {
    const key = [a, b].sort().join("|");
    const s = nodes.get(a);
    const t = nodes.get(b);
    if (!s || !t || seen.has(key)) return;
    seen.add(key);
    links.push({ source: s, target: t, kind, weight });
  };
  for (const { node, parent } of entries) if (parent) add(parent.id, node.id, "reports");
  // Teammates (same manager) form a ring, which gives the network its mesh without clutter.
  for (const { node } of entries) {
    const team = node.children;
    for (let i = 0; i < team.length && team.length > 1; i++) {
      if (team.length === 2 && i === 1) break;
      add(team[i].id, team[(i + 1) % team.length].id, "team");
    }
  }
  for (const c of collaboration) add(c.source, c.target, "works", c.weight);
  return { nodes: [...nodes.values()], links };
}

/** One step of a small force simulation: springs on links, repulsion between all nodes, gentle centering. */
function tick(nodes: SimNode[], links: SimLink[], alpha: number) {
  for (const { source: s, target: t, kind, weight } of links) {
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.max(Math.hypot(dx, dy), 1);
    const { length, strength } = LINK[kind];
    const k = ((dist - length - s.r - t.r) / dist) * strength * Math.min(weight, 4) * alpha;
    s.vx += dx * k;
    s.vy += dy * k;
    t.vx -= dx * k;
    t.vy -= dy * k;
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = Math.max(dx * dx + dy * dy, 900);
      const f = (12000 * alpha) / d2;
      a.vx -= dx * f * 0.05;
      a.vy -= dy * f * 0.05;
      b.vx += dx * f * 0.05;
      b.vy += dy * f * 0.05;
    }
  }
  for (const n of nodes) {
    n.vx -= n.x * 0.004 * alpha;
    n.vy -= n.y * 0.004 * alpha;
    if (n.pinned) {
      n.vx = n.vy = 0;
      continue;
    }
    n.vx *= 0.62;
    n.vy *= 0.62;
    n.x += n.vx;
    n.y += n.vy;
  }
}

export function CompanyGraph({
  roots,
  collaboration = [],
  focusDepartment,
  query,
  onSelect,
}: {
  roots: OrgNode[];
  collaboration?: CollaborationLink[];
  focusDepartment: string | null;
  query: string;
  onSelect: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const sim = useRef<{ nodes: SimNode[]; links: SimLink[]; alpha: number }>({ nodes: [], links: [], alpha: 0 });
  const [, setFrame] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const gesture = useRef<{ kind: "pan" | "node"; id?: string; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const fitted = useRef(false);

  // Rebuild when the organization changes, keeping the positions of agents that were already placed.
  const structure = useMemo(
    () => JSON.stringify([flatten(roots, null, []).map((e) => [e.node.id, e.parent?.id]), collaboration]),
    [roots, collaboration],
  );
  const built = useRef<string | null>(null);
  useEffect(() => {
    if (built.current === structure) return;
    built.current = structure;
    const previous = new Map(sim.current.nodes.map((n) => [n.id, n]));
    const graph = buildGraph(roots, collaboration);
    for (const n of graph.nodes) {
      const old = previous.get(n.id);
      if (old) Object.assign(n, { x: old.x, y: old.y });
    }
    sim.current = { ...graph, alpha: previous.size ? 0.3 : 1 };
  }, [roots, collaboration, structure]);
  // Stats (status, workload) refresh without disturbing the layout.
  useEffect(() => {
    const byId = new Map(flatten(roots, null, []).map((e) => [e.node.id, e.node]));
    for (const n of sim.current.nodes) n.node = byId.get(n.id) ?? n.node;
  }, [roots]);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const nodes = sim.current.nodes;
    if (!svg || !nodes.length) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 40, Math.max(...ys) + 60];
    const k = Math.min(1.2, svg.clientWidth / (maxX - minX), svg.clientHeight / (maxY - minY));
    setView({ k, x: svg.clientWidth / 2 - ((minX + maxX) / 2) * k, y: svg.clientHeight / 2 - ((minY + maxY) / 2) * k });
  }, []);

  /** First view: the whole company if it fits at a readable size, otherwise the CEO's area at 80%. */
  const openView = useCallback(() => {
    const svg = svgRef.current;
    const nodes = sim.current.nodes;
    if (!svg || !nodes.length) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const fitK = Math.min(
      svg.clientWidth / (Math.max(...xs) - Math.min(...xs) + 140),
      svg.clientHeight / (Math.max(...ys) - Math.min(...ys) + 120),
    );
    if (fitK >= 0.8) return fit();
    const ceo = nodes.find((n) => n.node.role_type === "ceo") ?? nodes[0];
    const k = 0.8;
    setView({ k, x: svg.clientWidth / 2 - ceo.x * k, y: svg.clientHeight / 2 - ceo.y * k });
  }, [fit]);

  // Animate the simulation until it cools down; fit the view once it has settled the first time.
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const s = sim.current;
      if (s.alpha > 0.004) {
        for (let i = 0; i < 4; i++) {
          tick(s.nodes, s.links, s.alpha);
          s.alpha *= 0.985;
        }
        setFrame((f) => f + 1);
        if (!fitted.current && s.alpha < 0.08) {
          fitted.current = true;
          openView();
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [openView]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };
  const zoom = (factor: number, cx?: number, cy?: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const px = cx ?? svg.clientWidth / 2;
    const py = cy ?? svg.clientHeight / 2;
    setView((v) => {
      const k = Math.min(3, Math.max(0.25, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = svg.getBoundingClientRect();
        zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });

  const { nodes, links } = sim.current;
  const q = query.trim().toLowerCase();
  const hits = q ? new Set(nodes.filter((n) => n.node.name.toLowerCase().includes(q)).map((n) => n.id)) : null;
  const flows: Flow[] = [];
  const start = hover ? nodes.find((n) => n.id === hover) : undefined;
  if (start) {
    for (const l of links) {
      if (l.source.id === start.id) flows.push({ from: start, to: l.target, delay: 0 });
      else if (l.target.id === start.id) flows.push({ from: start, to: l.source, delay: 0 });
    }
    let frontier = [start];
    for (let level = 1; level <= 4 && frontier.length; level++) {
      const next: SimNode[] = [];
      for (const lead of frontier) {
        for (const l of links) {
          if (l.kind !== "reports" || l.source.id !== lead.id) continue;
          if (level > 1) flows.push({ from: lead, to: l.target, delay: (level - 1) * 0.45 });
          next.push(l.target);
        }
      }
      frontier = next;
    }
  }
  const neighbors = start ? new Set([start.id, ...flows.map((f) => f.to.id)]) : null;
  const directLinks = flows.filter((f) => f.delay === 0).length;
  const dim = (n: SimNode) =>
    Boolean(
      (neighbors && !neighbors.has(n.id)) ||
        (hits && !hits.has(n.id)) ||
        (focusDepartment && n.node.department !== focusDepartment && n.node.role_type !== "ceo"),
    );
  const hovered = hover ? nodes.find((n) => n.id === hover) : undefined;
  const colors = [...new Set(nodes.map((n) => n.color))];
  const gradientId = (color: string) => `node-${color.slice(1)}`;

  return (
    <div className="relative h-full min-h-[32rem] overflow-hidden rounded-xl border bg-white">
      <svg
        ref={svgRef}
        className={cn("absolute inset-0 size-full touch-none select-none", gesture.current?.kind === "pan" ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={(e) => {
          const id = (e.target as Element).closest("[data-node]")?.getAttribute("data-node") ?? undefined;
          gesture.current = { kind: id ? "node" : "pan", id, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
          if (id) {
            const n = sim.current.nodes.find((m) => m.id === id);
            if (n) n.pinned = true;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 3) g.moved = true;
          if (g.kind === "pan") {
            setView((v) => ({ ...v, x: g.vx + e.clientX - g.x, y: g.vy + e.clientY - g.y }));
          } else if (g.moved) {
            const n = sim.current.nodes.find((m) => m.id === g.id);
            if (n) {
              Object.assign(n, toWorld(e.clientX, e.clientY));
              sim.current.alpha = Math.max(sim.current.alpha, 0.25);
            }
          }
        }}
        onPointerUp={() => {
          const g = gesture.current;
          gesture.current = null;
          if (g?.kind === "node" && g.id) {
            const n = sim.current.nodes.find((m) => m.id === g.id);
            if (n) n.pinned = false;
            if (!g.moved) onSelect(g.id);
          }
        }}
        onPointerCancel={() => (gesture.current = null)}
      >
        <defs>
          {colors.map((c) => (
            <linearGradient key={c} id={gradientId(c)} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.72" />
              <stop offset="100%" stopColor={c} />
            </linearGradient>
          ))}
          <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {links.map((l) => {
            const faded = dim(l.source) || dim(l.target);
            const lit = hover && (l.source.id === hover || l.target.id === hover);
            const color = l.kind === "works" ? "#8b5cf6" : l.target.color;
            return (
              <line
                key={`${l.source.id}-${l.target.id}`}
                x1={l.source.x}
                y1={l.source.y}
                x2={l.target.x}
                y2={l.target.y}
                stroke={color}
                strokeWidth={(l.kind === "works" ? 1 + Math.log2(l.weight + 1) : l.kind === "team" ? 0.9 : 1.4) * (lit ? 1.8 : 1)}
                strokeOpacity={faded ? 0.06 : lit ? 0.9 : l.kind === "team" ? 0.25 : 0.55}
                strokeDasharray={l.kind === "works" ? "4 3" : undefined}
              />
            );
          })}
          {flows.map(({ from, to, delay }) => (
            <g key={`flow-${from.id}-${to.id}`} pointerEvents="none">
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={to.color} strokeWidth={3} strokeOpacity={0.85} strokeDasharray="7 11" strokeLinecap="round">
                <animate attributeName="stroke-dashoffset" from="36" to="0" dur="0.9s" repeatCount="indefinite" />
              </line>
              <circle cx={from.x} cy={from.y} r={5} fill={to.color} stroke="#ffffff" strokeWidth={1.5} opacity={0}>
                <animate attributeName="cx" from={from.x} to={to.x} dur="1.3s" begin={`${delay}s`} repeatCount="indefinite" />
                <animate attributeName="cy" from={from.y} to={to.y} dur="1.3s" begin={`${delay}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="1.3s" begin={`${delay}s`} repeatCount="indefinite" />
              </circle>
            </g>
          ))}
          {nodes.map((n) => {
            const faded = dim(n);
            const leader = n.node.role_type !== "specialist";
            return (
              <g
                key={n.id}
                data-node={n.id}
                transform={`translate(${n.x} ${n.y})`}
                className="cursor-pointer"
                opacity={faded ? 0.18 : 1}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
              >
                {n.node.stats.status === "working" && (
                  <circle r={n.r + 4} fill="none" stroke={n.color} strokeWidth={2.5}>
                    <animate attributeName="r" values={`${n.r + 4};${n.r + 18}`} dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Soft glow, then a ring in the department color, then the avatar with initials. */}
                <circle r={n.r + 4} fill={n.color} opacity={0.3} filter="url(#node-glow)" />
                <circle
                  r={n.r + 4}
                  fill="#ffffff"
                  stroke={n.color}
                  strokeWidth={hits?.has(n.id) || hover === n.id ? 3 : 1.5}
                  strokeDasharray={n.node.client_id ? "3 2" : undefined}
                />
                <circle r={n.r} fill={n.node.is_active ? `url(#${gradientId(n.color)})` : "#cbd5e1"} />
                <text
                  dy="0.35em"
                  textAnchor="middle"
                  className="pointer-events-none fill-white font-semibold"
                  fontSize={Math.round(n.r * 0.72)}
                >
                  {initials(n.node.name)}
                </text>
                <circle
                  cx={n.r * 0.74}
                  cy={n.r * 0.74}
                  r={Math.max(3.5, n.r * 0.22)}
                  fill={STATUS_COLOR[n.node.stats.status] ?? STATUS_COLOR.idle}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
                <text
                  y={n.r + (leader ? 22 : 19)}
                  textAnchor="middle"
                  className={cn("pointer-events-none fill-slate-800", leader ? "font-semibold" : "font-medium")}
                  fontSize={leader ? 13 : 11}
                  stroke="#ffffff"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {n.node.name.replace(/ Agent$/, "")}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute top-3 left-3 w-60 rounded-xl border bg-white/95 p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: hovered.color }} />
            <span className="truncate text-sm font-semibold">{hovered.node.name}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {humanize(hovered.node.role_type)}
            {hovered.node.department_name ? ` · ${hovered.node.department_name}` : ""}
            {hovered.node.client_id ? " · client-built" : ""}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
            <div className="rounded-md bg-muted/60 py-1">
              <div className="font-semibold">{humanize(hovered.node.stats.status)}</div>
              <div className="text-muted-foreground">status</div>
            </div>
            <div className="rounded-md bg-muted/60 py-1">
              <div className="font-semibold tabular-nums">{hovered.node.stats.running_tasks + hovered.node.stats.queued_tasks}</div>
              <div className="text-muted-foreground">tasks</div>
            </div>
            <div className="rounded-md bg-muted/60 py-1">
              <div className="font-semibold tabular-nums">{directLinks}</div>
              <div className="text-muted-foreground">links</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">Click for details · drag to move</div>
        </div>
      )}

      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm">
        <button className="flex size-8 items-center justify-center hover:bg-muted" onClick={() => zoom(1.2)} aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <button className="flex size-8 items-center justify-center border-y hover:bg-muted" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
          <Minus className="size-4" />
        </button>
        <button className="flex size-8 items-center justify-center hover:bg-muted" onClick={fit} aria-label="Fit to screen">
          <Maximize className="size-4" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-white/95 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm">
        <span>Each color is one team · hover an agent to see its connections</span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-slate-500" /> reports to
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-slate-300" /> same team
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-violet-500" /> worked together
        </span>
        <span>· {Math.round(view.k * 100)}%</span>
      </div>
    </div>
  );
}
