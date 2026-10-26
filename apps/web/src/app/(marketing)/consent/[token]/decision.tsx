"use client";
import * as React from "react";
import { Button, Notice } from "@im/ui";
import { decideConsent } from "./actions";

export function ConsentDecision({ token }: { token: string }) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<{ status?: "granted" | "declined"; error?: string } | null>(null);
  if (result?.status) {
    return (
      <Notice tone={result.status === "granted" ? "ok" : "info"} className="mt-6" title={result.status === "granted" ? "Thank you — consent recorded" : "Declined"}>
        {result.status === "granted"
          ? "Your family member can now arrange cover for you. You'll get the policy documents, renewal reminders and claim updates on this phone too."
          : "Nothing is shared. Your family member can ask again if you change your mind."}
      </Notice>
    );
  }
  const decide = (granted: boolean) =>
    start(async () => {
      const r = await decideConsent(token, granted);
      setResult(r.ok ? { status: r.status } : { error: r.error });
    });
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" loading={pending} onClick={() => decide(true)} className="flex-1">I agree</Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => decide(false)} className="flex-1">No, thanks</Button>
      </div>
      {result?.error && <Notice tone="danger" className="mt-4">{result.error}</Notice>}
      <p className="mt-3 text-xs text-subtle">Tapping “I agree” records your consent with the date, time and this phone number.</p>
    </div>
  );
}
