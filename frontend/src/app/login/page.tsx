"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, ErrorBanner, Field, inputClass } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      router.replace(homeFor(user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-xl font-semibold tracking-tight">AICO</div>
          <div className="text-sm text-slate-500">Sign in to the AI agent company platform</div>
        </div>
        <ErrorBanner message={error} />
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
