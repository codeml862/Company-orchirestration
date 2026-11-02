"use client";

import { ChevronRight, KeyRound, Loader2, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { initials } from "@/components/shared/AgentAvatar";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { ToneBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { patch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, humanize, timeAgo } from "@/lib/format";
import type { User } from "@/lib/types";

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) setName(user.full_name);
  }, [user]);

  if (!user) return null;
  const changed = name.trim() !== user.full_name;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Your name can't be empty");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      updateUser(await patch<User>("/api/auth/me", { full_name: name.trim() }));
      toast.success("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="How you appear in Orchestria."
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/account/settings">
              <Settings /> Settings
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="items-center gap-0 p-6 text-center lg:self-start">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-600 text-2xl font-semibold text-white shadow-md">
            {initials(user.full_name)}
          </div>
          <div className="mt-4 text-lg font-semibold">{user.full_name}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
          <ToneBadge tone="violet" className="mt-3">
            {humanize(user.role)}
          </ToneBadge>
          <dl className="mt-6 grid w-full gap-2 border-t pt-4 text-left text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Member since</dt>
              <dd>{formatDate(user.created_at)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Last sign-in</dt>
              <dd>{timeAgo(user.last_login_at)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Account</dt>
              <dd>{user.is_active ? "Active" : "Deactivated"}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <UserRound className="size-4" /> Your details
              </span>
            }
          >
            <form onSubmit={saveName} className="grid max-w-md gap-4">
              <ErrorAlert message={error} className="mb-0" />
              <div className="grid gap-1.5">
                <Label htmlFor="full-name">Name</Label>
                <Input id="full-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                <p className="text-xs text-muted-foreground">Shown in the sidebar and on everything you approve.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user.email} disabled />
                <p className="text-xs text-muted-foreground">Your sign-in address. An administrator can change it.</p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !changed}>
                  {busy && <Loader2 className="animate-spin" />}
                  Save
                </Button>
                {changed && (
                  <Button type="button" variant="ghost" onClick={() => setName(user.full_name)}>
                    Discard
                  </Button>
                )}
              </div>
            </form>
          </SectionCard>

          <Link
            href="/account/settings/security"
            className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Password & sign-in</span>
              <span className="block text-sm text-muted-foreground">Change your password or sign out of this device.</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </>
  );
}
