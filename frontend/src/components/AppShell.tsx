"use client";

import {
  Activity,
  Bot,
  Briefcase,
  Building2,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Network,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { homeFor, isStaff, useAuth } from "@/lib/auth";
import { humanize } from "@/lib/format";
import type { Role } from "@/lib/types";

import { Spinner, cn } from "./ui";

const NAV: { href: string; label: string; icon: React.ElementType; roles: Role[] }[] = [
  { href: "/dashboard", label: "Executive Dashboard", icon: LayoutDashboard, roles: ["admin", "supervisor", "operator"] },
  { href: "/operations", label: "Live Operations", icon: Activity, roles: ["admin", "supervisor", "operator"] },
  { href: "/projects", label: "Projects", icon: FolderKanban, roles: ["admin", "supervisor", "operator"] },
  { href: "/organization", label: "Organization", icon: Network, roles: ["admin", "supervisor", "operator"] },
  { href: "/agents", label: "Agents", icon: Bot, roles: ["admin", "supervisor", "operator"] },
  { href: "/departments", label: "Departments", icon: Building2, roles: ["admin", "supervisor", "operator"] },
  { href: "/supervisor", label: "Supervisor Console", icon: ShieldCheck, roles: ["admin", "supervisor", "operator"] },
  { href: "/portal", label: "My Projects", icon: Briefcase, roles: ["client"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const staffOnly = !pathname.startsWith("/portal") && !pathname.startsWith("/projects/");
    if (user.role === "client" && staffOnly && pathname !== "/projects/new") router.replace(homeFor(user.role));
  }, [user, pathname, router]);

  if (loading || !user) return <Spinner />;

  const items = NAV.filter((item) => item.roles.includes(user.role));
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-slate-950 text-slate-300 lg:flex">
        <div className="px-5 py-5">
          <div className="text-lg font-semibold tracking-tight text-white">AICO</div>
          <div className="text-xs text-slate-400">AI Agent Outsourcing Company</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  active ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="truncate text-sm font-medium text-white">{user.full_name}</div>
          <div className="truncate text-xs text-slate-400">
            {user.email} · {humanize(user.role)}
          </div>
          <button onClick={logout} className="mt-3 flex items-center gap-2 text-xs text-slate-400 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <span className="font-semibold">AICO</span>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={items.find((i) => pathname.startsWith(i.href))?.href ?? ""}
            onChange={(e) => router.push(e.target.value)}
          >
            {items.map((i) => (
              <option key={i.href} value={i.href}>
                {i.label}
              </option>
            ))}
          </select>
          <button onClick={logout} className="text-sm text-slate-500">
            Sign out
          </button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function StaffOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!isStaff(user?.role)) return null;
  return <>{children}</>;
}
