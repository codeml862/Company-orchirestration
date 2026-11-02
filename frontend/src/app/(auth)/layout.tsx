"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { homeFor, useAuth } from "@/lib/auth";

/** Sign-in and sign-up screens: brand panel on the left, the form on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Signed in (just now, or already in another tab): go to the app.
  useEffect(() => {
    if (!loading && user) router.replace(homeFor(user.role));
  }, [loading, user, router]);

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <AuthBrandPanel />
      <main className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center gap-2 font-semibold lg:hidden">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          Orchestria
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" /> Role-based access. Every sign-in is recorded in the audit log.
        </p>
      </main>
    </div>
  );
}
