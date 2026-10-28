"use client";
import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { KeyRound, Mail, Smartphone } from "lucide-react";
import { Field, Input, Notice, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { sendMagicLink, sendPhoneOtp, signInWithPassword, verifyPhoneOtp } from "../actions";

type Mode = "phone" | "link" | "password";

/**
 * Sign-in (mockup 11): a code to your phone (+233) or a link to your email. A password remains available
 * behind "Use a password instead" for accounts that have one.
 */
export function SignInForm({ next, defaultMode = "phone" }: { next: string; defaultMode?: Mode }) {
  const [mode, setMode] = React.useState<Mode>(defaultMode);
  const tabs: { key: Mode; label: string; icon: React.ReactNode }[] = [
    { key: "phone", label: "Phone code", icon: <Smartphone aria-hidden className="size-4" /> },
    { key: "link", label: "Email link", icon: <Mail aria-hidden className="size-4" /> },
  ];

  return (
    <div>
      {mode !== "password" && (
        <div role="tablist" aria-label="Sign-in method" className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-mist p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={mode === t.key}
              onClick={() => setMode(t.key)}
              className={cn(
                "inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                mode === t.key ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel">
        {mode === "phone" && <PhoneForm next={next} onUseEmail={() => setMode("link")} />}
        {mode === "link" && <MagicLinkForm next={next} />}
        {mode === "password" && <PasswordForm next={next} />}
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        {mode === "password" ? (
          <button type="button" onClick={() => setMode("phone")} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"><Smartphone aria-hidden className="size-4" /> Use a phone code or email link instead</button>
        ) : (
          <button type="button" onClick={() => setMode("password")} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"><KeyRound aria-hidden className="size-4" /> Use a password instead</button>
        )}
      </p>
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
      <SubmitButton className="w-full" size="lg" pendingText="Signing in…">Sign in</SubmitButton>
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
        <Input id="ml-email" name="email" type="email" autoComplete="email" inputMode="email" required className="h-12" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" size="lg" pendingText="Sending…">Email me a sign-in link</SubmitButton>
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
        <p className="text-sm text-muted">We sent a 6-digit code to <span className="font-medium text-ink">{sentTo}</span>.</p>
        <FormMessage state={verifyState.error ? verifyState : sendState} />
        <Field label="6-digit code" htmlFor="token">
          <Input id="token" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required className="h-14 text-center text-[22px] tracking-[0.4em]" />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Checking…">Verify and sign in</SubmitButton>
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
          <span className="inline-flex items-center rounded-l-field border border-r-0 border-line bg-mist px-4 text-[15px] font-medium text-ink-2">+233</span>
          <Input id="phone" name="phone" type="tel" autoComplete="tel-national" inputMode="tel" placeholder="24 123 4567" required className="h-12 rounded-l-none text-[16px]" />
        </div>
      </Field>
      <FormMessage state={sendState} />
      {smsUnavailable && (
        <Notice tone="info">
          <button type="button" onClick={onUseEmail} className="font-semibold underline">Use email instead</button>
        </Notice>
      )}
      <SubmitButton className="w-full" size="lg" pendingText="Sending code…">Text me a code</SubmitButton>
    </form>
  );
}
