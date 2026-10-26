"use client";
import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, KeyRound, Smartphone } from "lucide-react";
import { Field, Input, Notice, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { sendMagicLink, sendPhoneOtp, signInWithPassword, verifyPhoneOtp } from "../actions";

type Mode = "password" | "link" | "phone";

export function SignInForm({ next, defaultMode = "password" }: { next: string; defaultMode?: Mode }) {
  const [mode, setMode] = React.useState<Mode>(defaultMode);
  const tabs: { key: Mode; label: string; icon: React.ReactNode }[] = [
    { key: "password", label: "Password", icon: <KeyRound aria-hidden className="size-4" /> },
    { key: "link", label: "Email link", icon: <Mail aria-hidden className="size-4" /> },
    { key: "phone", label: "Phone", icon: <Smartphone aria-hidden className="size-4" /> },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Sign-in method" className="mb-6 grid grid-cols-3 gap-1 rounded-xl bg-mist p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={mode === t.key}
            onClick={() => setMode(t.key)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              mode === t.key ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {mode === "password" && <PasswordForm next={next} />}
        {mode === "link" && <MagicLinkForm next={next} />}
        {mode === "phone" && <PhoneForm next={next} onUseEmail={() => setMode("link")} />}
      </div>
    </div>
  );
}

function PasswordForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInWithPassword, initialActionState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label="Email address" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">Forgot password?</Link>
      </div>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

function MagicLinkForm({ next }: { next: string }) {
  const [state, action] = useActionState(sendMagicLink, initialActionState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <p className="text-sm text-muted">We&apos;ll email you a one-time link. No password needed.</p>
      <Field label="Email address" htmlFor="ml-email">
        <Input id="ml-email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Sending…">Email me a sign-in link</SubmitButton>
    </form>
  );
}

function PhoneForm({ next, onUseEmail }: { next: string; onUseEmail: () => void }) {
  const [sendState, sendAction] = useActionState(sendPhoneOtp, initialActionState);
  const [verifyState, verifyAction] = useActionState(verifyPhoneOtp, initialActionState);
  const sentTo = sendState.ok ? (sendState.data?.phone as string | undefined) : undefined;
  const smsUnavailable = !!sendState.data?.smsUnavailable;

  if (sentTo) {
    return (
      <form action={verifyAction} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="phone" value={sentTo} />
        <FormMessage state={verifyState.error ? verifyState : sendState} />
        <Field label="6-digit code" htmlFor="token">
          <Input id="token" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required className="tracking-[0.4em]" />
        </Field>
        <SubmitButton className="w-full" pendingText="Checking…">Verify and sign in</SubmitButton>
        <p className="text-center text-sm text-muted">
          Didn&apos;t get it?{" "}
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => location.reload()}>Start again</button>
        </p>
      </form>
    );
  }

  return (
    <form action={sendAction} className="space-y-4" noValidate>
      <Field label="Mobile number" htmlFor="phone" hint="Ghana numbers only, e.g. 024 123 4567. Standard SMS rates may apply.">
        <div className="flex">
          <span className="inline-flex items-center rounded-l-field border border-r-0 border-line bg-mist px-3 text-sm text-muted">+233</span>
          <Input id="phone" name="phone" type="tel" autoComplete="tel-national" inputMode="tel" placeholder="24 123 4567" required className="rounded-l-none" />
        </div>
      </Field>
      <FormMessage state={sendState} />
      {smsUnavailable && (
        <Notice tone="info">
          <button type="button" onClick={onUseEmail} className="font-semibold underline">Use email instead</button>
        </Notice>
      )}
      <SubmitButton className="w-full" pendingText="Sending code…">Text me a code</SubmitButton>
    </form>
  );
}
