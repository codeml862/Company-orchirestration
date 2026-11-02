"use client";

import { Eye, EyeOff, Loader2, Lock, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/hooks";
import type { AuthProviders, User } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICON = "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground";

export function AuthHeading({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function IconInput({ icon: Icon, className, ...props }: React.ComponentProps<typeof Input> & { icon: LucideIcon }) {
  return (
    <div className="relative">
      <Icon className={ICON} />
      <Input className={cn("h-10 pl-9", className)} {...props} />
    </div>
  );
}

export function PasswordInput(props: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Lock className={ICON} />
      <Input type={visible ? "text" : "password"} className="h-10 px-9" {...props} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

export function AuthDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" className="mt-2 h-10 w-full" disabled={busy}>
      {busy && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

export function useAuthProviders(): AuthProviders | null {
  return useApi<AuthProviders>("/api/auth/providers").data;
}

/**
 * Runs a sign-in or sign-up attempt with busy/error state. On success the (auth) layout
 * redirects to the user's home, so the form stays busy until the page changes.
 */
export function useAuthAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(attempt: () => Promise<User>) {
    setBusy(true);
    setError(null);
    try {
      await attempt();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}
