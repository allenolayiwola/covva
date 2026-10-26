"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Notice, Spinner } from "@im/ui";
import { createClient } from "@/lib/supabase/client";

type Mode =
  | { kind: "loading" }
  | { kind: "enrol"; factorId: string; qr: string; secret: string }
  | { kind: "challenge"; factorId: string }
  | { kind: "error"; message: string };

/**
 * TOTP MFA: if the user has no verified factor we enrol one (QR code + secret),
 * otherwise we challenge the existing factor. Successful verification upgrades the
 * session to AAL2, which every admin page and action requires.
 */
export function MfaFlow({ next, email }: { next: string; email: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (error) return setMode({ kind: "error", message: error.message });
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setMode({ kind: "challenge", factorId: verified.id });

      // Remove abandoned, unverified TOTP enrolments before starting a new one.
      for (const f of data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Admin ${new Date().toISOString().slice(0, 10)}`,
      });
      if (cancelled) return;
      if (enrolError || !enrolled) return setMode({ kind: "error", message: enrolError?.message ?? "Could not start enrolment." });
      setMode({ kind: "enrol", factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind !== "enrol" && mode.kind !== "challenge") return;
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: code.replace(/\s+/g, "") });
    if (error) {
      setPending(false);
      setError(error.message.includes("Invalid") ? "That code didn't match. Codes change every 30 seconds — try the current one." : error.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
  }

  if (mode.kind === "loading") {
    return <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-4" /> Preparing verification…</p>;
  }
  if (mode.kind === "error") {
    return (
      <div className="space-y-4">
        <Notice tone="danger" title="MFA could not be started">{mode.message}</Notice>
        <p className="text-sm text-muted">
          Ensure TOTP MFA is enabled in Supabase Auth settings. For a local demo only, set <code>ADMIN_MFA_REQUIRED=false</code>.
        </p>
        <Button variant="outline" onClick={signOut}>Sign out</Button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-5">
      {mode.kind === "enrol" ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Set up an authenticator app for <strong>{email}</strong>. Scan this QR code with Google Authenticator, 1Password, Authy or similar.
          </p>
          <div className="flex justify-center rounded-xl border border-line bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG data URI from Supabase */}
            <img src={mode.qr} alt="QR code for your authenticator app" width={184} height={184} />
          </div>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary>
            <code className="mt-2 block break-all rounded-lg bg-mist p-2 font-mono text-ink">{mode.secret}</code>
          </details>
        </div>
      ) : (
        <p className="text-sm text-ink-2">Enter the 6-digit code from your authenticator app for <strong>{email}</strong>.</p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="Verification code" htmlFor="code">
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoFocus
          className="text-center font-mono text-lg tracking-[0.4em]"
        />
      </Field>
      <Button type="submit" className="w-full" loading={pending} disabled={code.replace(/\s/g, "").length !== 6}>
        {mode.kind === "enrol" ? "Verify and finish setup" : "Verify"}
      </Button>
      <button type="button" onClick={signOut} className="w-full text-center text-sm text-muted hover:text-ink">
        Use a different account
      </button>
    </form>
  );
}
