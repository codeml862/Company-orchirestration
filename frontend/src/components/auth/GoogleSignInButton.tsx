"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Google Identity Services: renders Google's own button and returns a signed ID token
// ("credential") that the API verifies before signing the user in.
const GSI_SRC = "https://accounts.google.com/gsi/client";

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        ux_mode?: "popup" | "redirect";
        auto_select?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let loader: Promise<GoogleIdentity> | null = null;

function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  loader ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google sign-in failed to load")));
    script.onerror = () => {
      loader = null;
      reject(new Error("Could not load Google sign-in. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-4", className)}>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.27a12 12 0 0 0 0 10.8l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.6l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

const LABELS = { continue_with: "Continue with Google", signup_with: "Sign up with Google" };

function PlaceholderButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="outline" className="h-10 w-full text-sm" disabled>
      <GoogleLogo /> {label}
    </Button>
  );
}

export function GoogleSignInButton({
  clientId,
  text = "continue_with",
  onCredential,
  onError,
}: {
  /** OAuth client ID from /api/auth/providers; null when Google sign-in is not enabled. */
  clientId: string | null;
  text?: keyof typeof LABELS;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        const parent = container.current;
        if (cancelled || !parent) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => handlers.current.onCredential(response.credential),
          ux_mode: "popup",
          auto_select: false,
        });
        parent.replaceChildren();
        google.accounts.id.renderButton(parent, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          logo_alignment: "center",
          width: Math.min(400, Math.max(200, parent.offsetWidth)),
        });
        setReady(true);
      })
      .catch((e: Error) => !cancelled && handlers.current.onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  if (!clientId) {
    return (
      <div className="grid gap-1.5">
        <PlaceholderButton label={LABELS[text]} />
        <p className="text-center text-xs text-muted-foreground">Google sign-in isn&apos;t enabled for this workspace yet.</p>
      </div>
    );
  }
  return (
    <div className="relative h-10">
      {!ready && <PlaceholderButton label={LABELS[text]} />}
      <div ref={container} className={cn("flex h-10 justify-center", !ready && "invisible absolute inset-0")} />
    </div>
  );
}
