"use client";
import { useActionState } from "react";
import { GHANA_REGIONS } from "@im/core";
import { Field, Input, Select, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { completeOnboarding } from "./actions";

export interface OnboardingDefaults {
  full_name: string;
  phone: string;
  region: string;
  ghana_card: string;
}

const REQUIRED = [
  {
    name: "terms",
    title: "Terms of use",
    body: "How the platform works. We provide the technology; we are not an insurer or broker and never hold your premium.",
  },
  {
    name: "privacy",
    title: "Privacy notice",
    body: "What we collect, why, how long we keep it and your rights under Ghana's Data Protection Act, 2012 (Act 843).",
  },
  {
    name: "data_sharing_broker",
    title: "Share my information with my broker of record",
    body: "Your named broker needs your details and documents to advise you, arrange cover and help with renewals and claims. Needed to request cover.",
  },
  {
    name: "data_sharing_insurer",
    title: "Share my information with insurers I ask for quotes from",
    body: "Participating insurers need your risk details to quote, issue policies and handle claims. Needed to request cover.",
  },
] as const;

const OPTIONAL = [
  { name: "marketing", title: "Tips and offers", body: "Occasional emails or texts about cover that may suit you. Unsubscribe any time." },
  {
    name: "ai_assistance",
    title: "AI-assisted help",
    body: "Let our AI assistant explain your cover and summarise documents. It never decides suitability or claims — your broker and insurer do.",
  },
] as const;

export function OnboardingForm({ defaults, next, termsVersion, privacyVersion }: { defaults: OnboardingDefaults; next: string; termsVersion: string; privacyVersion: string }) {
  const [state, action] = useActionState(completeOnboarding, initialActionState);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-8" noValidate>
      <input type="hidden" name="next" value={next} />
      <section aria-labelledby="about-you" className="space-y-4">
        <h2 id="about-you" className="text-lg font-semibold text-ink">About you</h2>
        <Field label="Full name" htmlFor="full_name" error={fe.full_name}>
          <Input id="full_name" name="full_name" defaultValue={defaults.full_name} autoComplete="name" required aria-invalid={!!fe.full_name} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile number" htmlFor="phone" error={fe.phone}>
            <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={defaults.phone} placeholder="024 123 4567" autoComplete="tel" required aria-invalid={!!fe.phone} />
          </Field>
          <Field label="Region" htmlFor="region" error={fe.region}>
            <Select id="region" name="region" defaultValue={defaults.region} required aria-invalid={!!fe.region}>
              <option value="">Choose…</option>
              {GHANA_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={<>Ghana Card number <span className="font-normal text-subtle">(optional)</span></>}
          htmlFor="ghana_card"
          error={fe.ghana_card}
          hint="Speeds up applications. Insurers need it before issuing most policies. We'll ask staff to verify it."
        >
          <Input id="ghana_card" name="ghana_card" defaultValue={defaults.ghana_card} placeholder="GHA-123456789-0" autoComplete="off" aria-invalid={!!fe.ghana_card} />
        </Field>
      </section>

      <section aria-labelledby="consents" className="space-y-3">
        <div>
          <h2 id="consents" className="text-lg font-semibold text-ink">Your consent</h2>
          <p className="text-sm text-muted">
            Terms {termsVersion} · Privacy notice {privacyVersion}. You can review or change optional choices any time in your profile.
          </p>
        </div>
        {REQUIRED.map((c) => (
          <ConsentRow key={c.name} name={c.name} title={c.title} body={c.body} required error={fe[c.name]} />
        ))}
        <p className="pt-2 text-sm font-medium text-ink-2">Optional</p>
        {OPTIONAL.map((c) => (
          <ConsentRow key={c.name} name={c.name} title={c.title} body={c.body} />
        ))}
      </section>

      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingText="Saving…">Continue to my account</SubmitButton>
    </form>
  );
}

function ConsentRow({ name, title, body, required, error }: { name: string; title: string; body: string; required?: boolean; error?: string }) {
  return (
    <div>
      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-xl border p-4 has-[:checked]:border-brand has-[:checked]:bg-mint-2/60",
          error ? "border-danger" : "border-line",
        )}
      >
        <input type="checkbox" name={name} className="mt-1 size-4 shrink-0 accent-brand" aria-invalid={!!error} aria-describedby={`${name}-desc`} />
        <span>
          <span className="block text-sm font-semibold text-ink">
            {title} {required && <span className="font-normal text-subtle">· required</span>}
          </span>
          <span id={`${name}-desc`} className="mt-0.5 block text-sm text-muted">{body}</span>
        </span>
      </label>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
