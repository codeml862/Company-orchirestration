"use client";

import { Clock, LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { PasswordForm } from "@/components/account/PasswordForm";
import { SettingRow } from "@/components/account/SettingRow";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";

/** When the current sign-in expires, read from the access token (a JWT) without verifying it. */
function sessionExpiry(): Date | null {
  try {
    const payload = getToken()?.split(".")[1];
    if (!payload) return null;
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof exp === "number" ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

export default function SecuritySettingsPage() {
  const { user, logout } = useAuth();
  const [expiry, setExpiry] = useState<Date | null>(null);
  useEffect(() => setExpiry(sessionExpiry()), []);
  if (!user) return null;

  return (
    <div className="space-y-6">
      <SectionCard title="Password" description="Signed in with Google? Your password is managed by Google.">
        <PasswordForm />
      </SectionCard>
      <SectionCard title="Session">
        <SettingRow
          icon={Clock}
          title={`Signed in as ${user.email}`}
          description={
            expiry
              ? `This sign-in expires ${formatDate(expiry.toISOString())}, then you'll be asked to sign in again.`
              : "Session details unavailable."
          }
        >
          <Button size="sm" variant="outline" onClick={logout}>
            <LogOut /> Sign out
          </Button>
        </SettingRow>
      </SectionCard>
    </div>
  );
}
