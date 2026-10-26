"use client";
import * as React from "react";
import { useActionState } from "react";
import { Field, Input, Select, Textarea, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { COMPLAINT_CATEGORY_LABEL } from "../../_lib/labels";
import { fileComplaint } from "../actions";

type Opt = { id: string; label: string };

const PARTIES = [
  { v: "broker", label: "My broker", body: "Advice, service, delays or how your request was handled." },
  { v: "insurer", label: "The insurer", body: "Underwriting, policy documents, claim decisions or payments." },
  { v: "platform", label: "This platform", body: "The app or website, your data, or how information was shown." },
] as const;

export function ComplaintForm({
  requests,
  policies,
  claims,
  defaults,
}: {
  requests: Opt[];
  policies: Opt[];
  claims: Opt[];
  defaults: { requestId?: string; policyId?: string; claimId?: string; againstParty?: "broker" | "insurer" | "platform" };
}) {
  const [state, action] = useActionState(fileComplaint, initialActionState);
  const [party, setParty] = React.useState<string>(defaults.againstParty ?? (defaults.claimId ? "insurer" : "broker"));
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6" noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">Who is your complaint about?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PARTIES.map((p) => (
            <label
              key={p.v}
              className={cn(
                "cursor-pointer rounded-card border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                party === p.v ? "border-brand bg-mint-2/60" : "border-line hover:bg-mist",
              )}
            >
              <input type="radio" name="againstParty" value={p.v} checked={party === p.v} onChange={() => setParty(p.v)} className="sr-only" />
              <span className="block font-medium text-ink">{p.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{p.body}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="What is it about?" htmlFor="category" error={fe.category}>
        <Select id="category" name="category" defaultValue={defaults.claimId ? "claims" : ""} aria-invalid={!!fe.category}>
          <option value="">Choose…</option>
          {Object.entries(COMPLAINT_CATEGORY_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Related request" htmlFor="requestId" error={fe.link}>
          <Select id="requestId" name="requestId" defaultValue={defaults.requestId ?? ""}>
            <option value="">None</option>
            {requests.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Related policy" htmlFor="policyId">
          <Select id="policyId" name="policyId" defaultValue={defaults.policyId ?? ""}>
            <option value="">None</option>
            {policies.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Related claim" htmlFor="claimId">
          <Select id="claimId" name="claimId" defaultValue={defaults.claimId ?? ""}>
            <option value="">None</option>
            {claims.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Subject" htmlFor="subject" error={fe.subject}>
        <Input id="subject" name="subject" maxLength={200} placeholder="e.g. No reply about my renewal for two weeks" aria-invalid={!!fe.subject} />
      </Field>
      <Field label="What happened?" htmlFor="description" error={fe.description} hint="Include dates, who you dealt with and what you've already tried.">
        <Textarea id="description" name="description" maxLength={5000} className="min-h-40" aria-invalid={!!fe.description} />
      </Field>
      <Field label={<>What would put it right? <span className="font-normal text-subtle">(optional)</span></>} htmlFor="desiredOutcome">
        <Textarea id="desiredOutcome" name="desiredOutcome" maxLength={2000} className="min-h-20" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Filing…">File complaint</SubmitButton>
    </form>
  );
}
