"use client";

import { Bell, BellOff, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { notificationsSupported } from "@/components/account/DecisionNotifier";
import { SettingRow } from "@/components/account/SettingRow";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isStaff, useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = usePreferences();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPermission(notificationsSupported() ? Notification.permission : "unsupported");
  }, []);

  if (!user) return null;
  const staff = isStaff(user.role);
  const on = prefs.notifyDecisions && permission === "granted";

  async function toggle(enable: boolean) {
    if (!enable) {
      setPrefs({ notifyDecisions: false });
      return;
    }
    const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      setPrefs({ notifyDecisions: true });
      toast.success("Notifications on for this browser");
    } else {
      toast.error("The browser blocked notifications. Allow them in the site settings, then try again.");
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Desktop notifications" description="Checked every 30 seconds while Orchestria is open">
        <div className="divide-y">
          <SettingRow
            icon={on ? Bell : BellOff}
            title={staff ? "Decisions waiting" : "Questions about your projects"}
            description={
              permission === "unsupported"
                ? "This browser doesn't support desktop notifications."
                : permission === "denied"
                  ? "Notifications are blocked for this site. Allow them in the browser's site settings."
                  : staff
                    ? "Get a notification when a new approval needs a decision."
                    : "Get a notification when an agent needs your answer."
            }
          >
            <Switch
              checked={on}
              disabled={permission === "unsupported" || permission === "denied"}
              onCheckedChange={(v) => void toggle(v)}
              aria-label="Desktop notifications"
            />
          </SettingRow>
          {on && (
            <SettingRow icon={Send} title="Test" description="Check that notifications reach you.">
              <Button size="sm" variant="outline" onClick={() => new Notification("Orchestria", { body: "Notifications are working." })}>
                Send a test
              </Button>
            </SettingRow>
          )}
        </div>
      </SectionCard>
      <p className="text-xs text-muted-foreground">Saved on this device. Other browsers keep their own setting.</p>
    </div>
  );
}
