import {
  Activity,
  Bot,
  Briefcase,
  Building2,
  FileCheck2,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  Network,
  Share2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  /** Other path prefixes that belong to this item (e.g. a client's project pages). */
  matches?: string[];
  /** Only the exact href, not pages below it (so /portal is not active on /portal/agents). */
  exact?: boolean;
}

const STAFF: Role[] = ["admin", "supervisor", "operator"];

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Executive Dashboard", icon: LayoutDashboard, roles: STAFF },
      { href: "/operations", label: "Live Operations", icon: Activity, roles: STAFF },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban, roles: STAFF },
      { href: "/reports", label: "Final Reports", icon: FileCheck2, roles: STAFF },
      { href: "/supervisor", label: "Supervisor Console", icon: ShieldCheck, roles: STAFF },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/organization", label: "Organization", icon: Network, roles: STAFF },
      { href: "/graph", label: "Company Graph", icon: Share2, roles: STAFF },
      { href: "/agents", label: "Agents", icon: Bot, roles: STAFF },
      { href: "/departments", label: "Departments", icon: Building2, roles: STAFF },
    ],
  },
  {
    label: "Administration",
    items: [{ href: "/admin", label: "Clients & Users", icon: UsersRound, roles: STAFF }],
  },
  {
    label: "Client portal",
    items: [
      { href: "/portal", label: "My Projects", icon: Briefcase, roles: ["client"], matches: ["/projects"], exact: true },
      { href: "/reports", label: "Final Reports", icon: FileCheck2, roles: ["client"] },
      { href: "/portal/agents", label: "My Agents", icon: Bot, roles: ["client"] },
    ],
  },
];

export function navFor(role: Role) {
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(role)) })).filter(
    (group) => group.items.length > 0,
  );
}

export function isActive(item: NavItem, pathname: string) {
  if (pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`))) return true;
  return (item.matches ?? []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
