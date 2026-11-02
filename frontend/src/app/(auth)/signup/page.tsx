"use client";

import { Building2, Mail, UserRound } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

const signInLink = (
  <Link href="/login" className="font-medium text-primary hover:underline">
    Sign in
  </Link>
);

export default function SignupPage() {
  const { signup, signupWithGoogle } = useAuth();
  const providers = useAuthProviders();
  const { busy, error, setError, run } = useAuthAction();
  const [form, setForm] = useState({ company_name: "", full_name: "", email: "", password: "" });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  if (providers?.signup_enabled === false) {
    return (
      <>
        <AuthHeading title="Accounts are invite-only" subtitle="Self-service sign-up is turned off for this workspace." />
        <p className="text-sm text-muted-foreground">Ask your Orchestria administrator to create an account for you.</p>
        <Button asChild variant="outline" className="mt-6 h-10 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </>
    );
  }

  function withGoogle(credential: string) {
    const company = form.company_name.trim();
    if (!company) {
      setError("Enter your company name first, then sign up with Google.");
      return;
    }
    void run(() => signupWithGoogle(credential, company));
  }

  return (
    <>
      <AuthHeading
        title="Create your account"
        subtitle="Register your company to submit projects to the AI team and follow them live."
      />
      <ErrorAlert message={error} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => signup(form));
        }}
        className="grid gap-4"
      >
        <FormField label="Company name" htmlFor="company">
          <IconInput
            id="company"
            icon={Building2}
            placeholder="Acme Inc."
            value={form.company_name}
            onChange={set("company_name")}
            autoComplete="organization"
            maxLength={200}
            required
          />
        </FormField>

        <GoogleSignInButton
          clientId={providers?.google_client_id ?? null}
          text="signup_with"
          onCredential={withGoogle}
          onError={setError}
        />

        <AuthDivider>or sign up with email</AuthDivider>

        <FormField label="Your name" htmlFor="full-name">
          <IconInput
            id="full-name"
            icon={UserRound}
            placeholder="Jane Doe"
            value={form.full_name}
            onChange={set("full_name")}
            autoComplete="name"
            maxLength={200}
            required
          />
        </FormField>
        <FormField label="Work email" htmlFor="email">
          <IconInput
            id="email"
            icon={Mail}
            type="email"
            placeholder="you@company.com"
            value={form.email}
            onChange={set("email")}
            autoComplete="email"
            required
          />
        </FormField>
        <FormField label="Password" htmlFor="password" hint="At least 10 characters.">
          <PasswordInput
            id="password"
            placeholder="Create a password"
            value={form.password}
            onChange={set("password")}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </FormField>
        <SubmitButton busy={busy}>Create account</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? {signInLink}</p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        This creates a client account. Staff accounts are added by an administrator.
      </p>
    </>
  );
}
