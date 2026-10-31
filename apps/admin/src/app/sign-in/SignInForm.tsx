"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, Notice } from "@im/ui";
import { createClient } from "@/lib/supabase/client";

export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(fd.get("email") ?? "").trim(),
      password: String(fd.get("password") ?? ""),
    });
    if (error) {
      setPending(false);
      setError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
      return;
    }
    // MFA page decides whether to enrol, challenge or continue (when MFA is disabled).
    router.replace(`/mfa?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <p><Link href="/forgot-password" className="text-sm font-semibold text-brand hover:underline">Forgot password?</Link></p>
      <p className="text-sm text-muted">Need help? Contact your Covva platform administrator.</p>
      <Button type="submit" className="w-full" loading={pending}>
        Continue
      </Button>
    </form>
  );
}
