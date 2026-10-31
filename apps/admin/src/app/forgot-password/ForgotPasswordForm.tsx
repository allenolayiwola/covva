"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Field, Input, Notice } from "@im/ui";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    try {
      await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } finally {
      // Identical result for unknown accounts, provider errors and successful requests.
      setSent(true);
      setPending(false);
    }
  }
  return <form onSubmit={(e) => { void submit(e).catch(() => {}); }} className="space-y-4">
    {sent ? <Notice tone="ok">If an account matches that email, you will receive a password reset link.</Notice> : <>
      <Field label="Work email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Button type="submit" className="w-full" loading={pending}>Send reset link</Button>
    </>}
    <Link href="/sign-in" className="inline-block text-sm font-semibold text-brand">Back to sign in</Link>
  </form>;
}
