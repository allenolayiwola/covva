"use client";
import { useActionState } from "react";
import { TELEMATICS_CONSENT } from "@im/core";
import { Field, Input } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { enrolInTelematics, withdrawFromTelematics } from "./actions";

/** Consent wording + enrol for one motor policy. The wording is the same text the mobile app shows. */
export function EnrolForm({ policyId, policyLabel }: { policyId: string; policyLabel: string }) {
  const [state, action] = useActionState(enrolInTelematics, initialActionState);
  const c = TELEMATICS_CONSENT;
  return (
    <form action={action} className="space-y-4" data-testid="telematics-enrol-form">
      <input type="hidden" name="policyId" value={policyId} />
      <div className="rounded-card border border-line bg-mist/60 p-4 text-sm text-ink-2">
        <p className="font-semibold text-ink">{c.title}</p>
        <p className="mt-2 font-medium text-ink">What the app records on each trip</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {c.collected.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="mt-2 font-medium text-ink">What is not collected</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {c.notCollected.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="mt-2"><span className="font-medium text-ink">How it is used.</span> {c.use}</p>
        <p className="mt-2"><span className="font-medium text-ink">How long we keep it.</span> {c.retention}</p>
        <p className="mt-2"><span className="font-medium text-ink">Changing your mind.</span> {c.withdrawal}</p>
        <p className="mt-2 text-[13px] text-muted">Consent version {c.version}. Your decision is recorded with the date and time.</p>
      </div>
      <Field label="Phone name (optional)" htmlFor={`dl-${policyId}`} hint="So you recognise the device later, e.g. “Kofi's Samsung”."><Input id={`dl-${policyId}`} name="deviceLabel" maxLength={80} className="h-11" /></Field>
      <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-card border border-line p-4 text-[15px] leading-relaxed text-ink-2 has-[:checked]:border-brand has-[:checked]:bg-mint/40">
        <input type="checkbox" name="agree" className="mt-1 size-5 shrink-0 accent-brand" required />
        <span>I agree to share trip summaries for <strong className="font-semibold text-ink">{policyLabel}</strong> so my insurer can see a monthly driving score. I can stop at any time.</span>
      </label>
      <SubmitButton pendingText="Enrolling…">Enrol this policy</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function WithdrawForm({ enrolmentId }: { enrolmentId: string }) {
  const [state, action] = useActionState(withdrawFromTelematics, initialActionState);
  return (
    <form action={action} className="space-y-3" onSubmit={(e) => { if (!window.confirm("Stop driving scoring for this policy? Collection stops immediately and your trip summaries are deleted within the retention period.")) e.preventDefault(); }}>
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <SubmitButton variant="outline" size="sm" pendingText="Stopping…">Stop driving scoring</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
