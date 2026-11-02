"use client";

import { RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DecisionNotifier } from "@/components/account/DecisionNotifier";
import { LoadingScreen } from "@/components/shared/Loading";
import { homeFor, useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";

import { AppSidebar } from "./AppSidebar";
import { NAV_GROUPS, isActive } from "./nav";

// Account pages live outside the sidebar navigation; name them in the top bar.
const ACCOUNT_TITLES: [string, string][] = [
  ["/account/profile", "Profile"],
  ["/account/settings", "Settings"],
  ["/account/help", "Help & support"],
];

/** Full-screen state shown before the app can render: a short splash, or why the server can't be reached. */
function AppSplash({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, []);
  if (!error) {
    return (
      <LoadingScreen>
        {slow && <p className="relative max-w-sm text-xs text-muted-foreground">Still connecting. The server may be restarting.</p>}
      </LoadingScreen>
    );
  }
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-sidebar px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-white shadow-lg">
        <Sparkles className="size-6" />
      </div>
      {error ? (
        <>
          <div className="flex items-center gap-2 text-base font-semibold">
            <WifiOff className="size-4 text-rose-600" /> Can&apos;t reach Orchestria
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">{error} You are still signed in; try again in a moment.</p>
          <Button size="sm" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, connectionError, retry } = useAuth();
  const [prefs] = usePreferences();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && !connectionError) router.replace("/login");
  }, [loading, user, connectionError, router]);

  useEffect(() => {
    if (!user) return;
    // Clients only ever see their portal and their own project pages.
    const clientArea =
      pathname.startsWith("/portal") ||
      pathname.startsWith("/projects/") ||
      pathname.startsWith("/reports") ||
      pathname.startsWith("/account");
    if (user.role === "client" && !clientArea) router.replace(homeFor(user.role));
  }, [user, pathname, router]);

  if (!user) return <AppSplash error={loading ? null : connectionError} onRetry={retry} />;

  const current = NAV_GROUPS.flatMap((g) => g.items).find((item) => item.roles.includes(user.role) && isActive(item, pathname));
  return (
    <SidebarProvider defaultOpen={!prefs.sidebarCollapsed}>
      <DecisionNotifier user={user} />
      <AppSidebar user={user} onSignOut={logout} />
      <SidebarInset className="md:border md:border-sidebar-border">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="text-sm font-medium">{current?.label ?? ACCOUNT_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Orchestria"}</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
