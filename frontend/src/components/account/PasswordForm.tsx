"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { FieldError } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        autoComplete={autoComplete}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Change your own password (POST /api/auth/me/password); the current password is required. */
export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = {
    current: current ? null : "Enter your current password",
    next: next.length < 10 ? "Use at least 10 characters" : next === current ? "Choose a different password" : null,
    confirm: confirm === next ? null : "The passwords don't match",
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/me/password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      toast.success("Password changed. Use it the next time you sign in.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid max-w-md gap-4">
      <ErrorAlert message={error} className="mb-0" />
      <div className="grid gap-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <PasswordInput
          id="current-password"
          value={current}
          onChange={setCurrent}
          invalid={Boolean(show("current"))}
          autoComplete="current-password"
        />
        <FieldError>{show("current")}</FieldError>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <PasswordInput id="new-password" value={next} onChange={setNext} invalid={Boolean(show("next"))} autoComplete="new-password" />
        {show("next") ? (
          <FieldError>{show("next")}</FieldError>
        ) : (
          <p className="text-xs text-muted-foreground">At least 10 characters. A short sentence works well.</p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <PasswordInput
          id="confirm-password"
          value={confirm}
          onChange={setConfirm}
          invalid={Boolean(show("confirm"))}
          autoComplete="new-password"
        />
        <FieldError>{show("confirm")}</FieldError>
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Change password
        </Button>
      </div>
    </form>
  );
}
