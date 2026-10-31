"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Field, Input, Notice } from "@im/ui";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@im/db";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;
function recoveryClient() {
  return client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { isSingleton: false, auth: { detectSessionInUrl: false } },
  );
}

// Share the exchange promise across Strict Mode effect replays: PKCE codes are single-use.
let exchange: Promise<boolean> | undefined;
function recoverySession() {
  return exchange ??= (async () => {
    const code = new URL(window.location.href).searchParams.get("code");
    if (!code) return false;
    const { data, error } = await recoveryClient().auth.exchangeCodeForSession(code);
    window.history.replaceState(null, "", "/reset-password");
    return !error && !!data.session;
  })();
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    void recoverySession().then((valid) => {
      if (!active) return;
      if (valid) setReady(true);
      else setError("This reset link is invalid or expired. Request a new link in the browser where you requested it.");
    }).catch(() => { if (active) setError("Could not verify this reset link. Request a new link."); });
    return () => { active = false; };
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password"));
    if (password !== fd.get("confirm")) { setError("Passwords must match."); return; }
    setPending(true);
    setError(null);
    try {
      const { error } = await recoveryClient().auth.updateUser({ password });
      if (error) { setError("Could not update your password. Try a stronger password or request a new link."); return; }
      router.replace("/mfa");
      router.refresh();
    } catch { setError("Could not update your password. Please try again."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    {error && <Notice tone="danger">{error}</Notice>}
    {ready && <>
      <Field label="New password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <Field label="Confirm password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <Button type="submit" className="w-full" loading={pending}>Update password</Button>
    </>}
    <Link href="/forgot-password" className="inline-block text-sm font-semibold text-brand">Request a new reset link</Link>
  </form>;
}
