"use client";

import { Bell, Shield, SlidersHorizontal, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/account/settings/general", label: "General", hint: "Start page and layout", icon: SlidersHorizontal },
  { href: "/account/settings/notifications", label: "Notifications", hint: "Desktop alerts", icon: Bell },
  { href: "/account/settings/security", label: "Security", hint: "Password and session", icon: Shield },
];

/** Settings: a section menu on the left, the chosen section's settings on the right. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Preferences for your account and this device."
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/account/profile">
              <UserRound /> Profile
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-2 md:sticky md:top-6 md:flex-col md:self-start" aria-label="Settings sections">
          {SECTIONS.map(({ href, label, hint, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className={cn("block text-sm", active && "font-medium")}>{label}</span>
                  <span className="hidden text-xs text-muted-foreground md:block">{hint}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
