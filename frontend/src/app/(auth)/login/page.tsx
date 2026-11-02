"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  AuthDivider,
  AuthHeading,
  IconInput,
  PasswordInput,
  SubmitButton,
  useAuthAction,
  useAuthProviders,
} from "@/components/auth/AuthForm";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { FormField } from "@/components/shared/FormField";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const providers = useAuthProviders();
  const { busy, error, setError, run } = useAuthAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <>
      <AuthHeading title="Welcome back" subtitle="Sign in to your Orchestria workspace to continue." />
      <ErrorAlert message={error} />

      <GoogleSignInButton
        clientId={providers?.google_client_id ?? null}
        onCredential={(credential) => void run(() => loginWithGoogle(credential))}
        onError={setError}
      />

      <AuthDivider>or sign in with email</AuthDivider>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => login(email, password));
        }}
        className="grid gap-4"
      >
        <FormField label="Email" htmlFor="email">
          <IconInput
            id="email"
            icon={Mail}
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </FormField>
        <FormField label="Password" htmlFor="password">
          <PasswordInput
            id="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </FormField>
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {providers?.signup_enabled === false ? (
          "Don't have an account? Your administrator creates it for you."
        ) : (
          <>
            New to Orchestria?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </>
  );
}
