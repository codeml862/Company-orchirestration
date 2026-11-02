"use client";

import { ChevronsUpDown, LifeBuoy, LogOut, Settings, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { homeFor, isStaff } from "@/lib/auth";
import { humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Approval, User } from "@/lib/types";
import { cn } from "@/lib/utils";

import { isActive, navFor } from "./nav";

const ACCOUNT_LINKS = [
  { href: "/account/profile", label: "Profile", icon: UserRound },
  { href: "/account/settings", label: "Settings", icon: Settings },
  { href: "/account/help", label: "Help & support", icon: LifeBuoy },
];

const BRAND_MARK = "bg-gradient-to-br from-indigo-400 to-violet-600 text-white ring-1 ring-white/15";

const NAV_BUTTON = cn(
  "relative h-9 rounded-lg text-sidebar-foreground/70 transition-colors",
  "hover:bg-sidebar-accent hover:text-sidebar-foreground",
  "data-active:bg-sidebar-primary/15 data-active:text-sidebar-foreground data-active:hover:bg-sidebar-primary/20",
  "data-active:[&_svg]:text-sidebar-primary",
  // Accent bar on the active item; hidden when the sidebar is collapsed to icons.
  "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary",
  "before:opacity-0 before:transition-opacity data-active:before:opacity-100 group-data-[collapsible=icon]:before:hidden",
);

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function AppSidebar({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const pathname = usePathname();
  // Pending approvals waiting for a human, shown as a badge on the Supervisor Console.
  const { data: pending } = useApi<Approval[]>(isStaff(user.role) ? "/api/approvals" : null, 15000);
  const badges: Record<string, number> = { "/supervisor": pending?.length ?? 0 };

  return (
    <Sidebar
      variant="inset"
      collapsible="icon"
      // A white card like the content panel beside it.
      className="*:data-[slot=sidebar-inner]:rounded-xl *:data-[slot=sidebar-inner]:border *:data-[slot=sidebar-inner]:border-sidebar-border *:data-[slot=sidebar-inner]:bg-card *:data-[slot=sidebar-inner]:shadow-sm"
    >
      {/* Same height and bottom border as the page header in AppShell, so the two lines meet. */}
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border py-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-sidebar-accent/60">
              <Link href={homeFor(user.role)}>
                <div
                  className={cn(
                    "flex aspect-square size-8 items-center justify-center rounded-lg shadow-md shadow-black/30",
                    BRAND_MARK,
                  )}
                >
                  <Sparkles className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold tracking-tight">Orchestria</span>
                  <span className="truncate text-xs text-sidebar-foreground/55">AI Agent Outsourcing</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1">
        {navFor(user.role).map((group) => (
          <SidebarGroup key={group.label} className="py-1.5">
            <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider text-sidebar-foreground/40 uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => {
                const badge = badges[item.href] ?? 0;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item, pathname)}
                      tooltip={badge ? `${item.label} (${badge})` : item.label}
                      className={NAV_BUTTON}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        {badge > 0 && (
                          <span className="absolute top-1.5 left-5 hidden size-2 rounded-full bg-amber-400 ring-2 ring-card group-data-[collapsible=icon]:block" />
                        )}
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {badge > 0 && (
                      <SidebarMenuBadge className="right-2 rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-amber-950 peer-hover/menu-button:text-amber-950 peer-data-active/menu-button:text-amber-950 peer-data-[size=default]/menu-button:top-2">
                        {badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className={cn("rounded-lg text-xs font-semibold", BRAND_MARK)}>
                      {initials(user.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{user.full_name}</span>
                      <span className="shrink-0 rounded-full bg-sidebar-primary/20 px-1.5 py-px text-[10px] font-medium text-sidebar-primary">
                        {humanize(user.role)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-sidebar-foreground/55">{user.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" side="top" align="start">
                <DropdownMenuLabel className="flex items-center gap-3 font-normal">
                  <Avatar className="size-9 rounded-lg">
                    <AvatarFallback className={cn("rounded-lg text-xs font-semibold", BRAND_MARK)}>
                      {initials(user.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{user.full_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {ACCOUNT_LINKS.map(({ href, label, icon: Icon }) => (
                    <DropdownMenuItem key={href} asChild>
                      <Link href={href}>
                        <Icon /> {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
