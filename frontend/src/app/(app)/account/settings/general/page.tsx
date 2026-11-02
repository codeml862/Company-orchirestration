"use client";

import { Home, PanelLeft } from "lucide-react";
import { toast } from "sonner";

import { SettingRow } from "@/components/account/SettingRow";
import { SectionCard } from "@/components/shared/SectionCard";
import { Switch } from "@/components/ui/switch";
import { isStaff, useAuth } from "@/lib/auth";
import { START_PAGES, usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export default function GeneralSettingsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = usePreferences();
  if (!user) return null;

  return (
    <div className="space-y-6">
      {isStaff(user.role) && (
        <SectionCard title="Start page" description="Where you land after signing in">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Start page">
            {START_PAGES.map((p) => (
              <button
                key={p.href}
                type="button"
                role="radio"
                aria-checked={prefs.startPage === p.href}
                onClick={() => {
                  setPrefs({ startPage: p.href });
                  toast.success(`You'll start on ${p.label}`);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  prefs.startPage === p.href ? "border-primary bg-primary/5 font-medium text-primary" : "hover:bg-muted/50",
                )}
              >
                <Home className="size-4 shrink-0" />
                {p.label}
              </button>
            ))}
          </div>
        </SectionCard>
      )}
      <SectionCard title="Layout">
        <SettingRow
          icon={PanelLeft}
          title="Collapsed sidebar"
          description="Start with the sidebar showing icons only. Ctrl/⌘ + B toggles it anytime."
        >
          <Switch
            checked={prefs.sidebarCollapsed}
            onCheckedChange={(v) => setPrefs({ sidebarCollapsed: v })}
            aria-label="Start with the sidebar collapsed"
          />
        </SettingRow>
      </SectionCard>
      <p className="text-xs text-muted-foreground">These preferences are saved on this device.</p>
    </div>
  );
}
