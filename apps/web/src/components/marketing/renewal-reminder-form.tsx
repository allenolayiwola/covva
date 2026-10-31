"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { BellRing, CircleCheck } from "lucide-react";
import { Button, Checkbox, Field, Input, Notice, Select, cn } from "@im/ui";
import { submitRenewalLead as submitLead, type LeadState } from "@/app/(site)/(marketing)/actions";
import { track } from "./analytics";

export interface ReminderCategory { slug: string; name: string }
const INITIAL: LeadState = { status: "idle" };

/**
 * Renewal-reminder sign-up: "Tell us when your current policy expires and we'll remind you with
 * better quotes." Captures a `customer` lead tagged `renewal_reminder` with `metadata.expires_on`.
 */
export function RenewalReminderForm({ categories, defaultCategory, className }: { categories: ReminderCategory[]; defaultCategory?: string; className?: string }) {
  const [instance, setInstance] = React.useState(0);
  return <Instance key={instance} categories={categories} defaultCategory={defaultCategory} className={className} onReset={() => setInstance((n) => n + 1)} />;
}

function Instance({ categories, defaultCategory, className, onReset }: { categories: ReminderCategory[]; defaultCategory?: string; className?: string; onReset: () => void }) {
  const [state, formAction, pending] = useActionState(submitLead, INITIAL);
  const uid = React.useId();
  const id = (f: string) => `${uid}-${f}`;
  const err = state.fieldErrors ?? {};
  const val = state.values ?? {};
  const startedRef = React.useRef<HTMLInputElement>(null);
  const pageRef = React.useRef<HTMLInputElement>(null);
  const statusRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Bot guard + attribution, written straight to the hidden inputs (no state → no re-render).
    if (startedRef.current) startedRef.current.value = String(Date.now());
    if (pageRef.current) pageRef.current.value = window.location.pathname;
  }, []);
  React.useEffect(() => {
    if (state.status !== "idle") statusRef.current?.focus();
    if (state.status === "success") track("generate_lead", { kind: "customer", tag: "renewal_reminder", page: window.location.pathname });
  }, [state]);

  if (state.status === "success") {
    return (
      <div ref={statusRef} tabIndex={-1} role="status" className={cn("rounded-card border border-line bg-white p-6 text-center focus:outline-none", className)}>
        <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-mint text-brand"><CircleCheck className="size-6" /></span>
        <p className="mt-4 text-lg font-semibold text-ink">Reminder set.</p>
        <p className="mx-auto mt-1 max-w-sm text-[14.5px] leading-relaxed text-muted">We will get in touch about 30 days before your policy ends, with quotes from participating insurers to compare.</p>
        <button type="button" onClick={onReset} className="mt-4 rounded text-sm font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Add another policy</button>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className={cn("rounded-card border border-line bg-white p-5 sm:p-6", className)} aria-labelledby={id("title")}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-mint text-brand-deep"><BellRing className="size-5" /></span>
        <div>
          <h3 id={id("title")} className="text-[17px] font-semibold text-ink">Already insured? Let us remind you.</h3>
          <p className="mt-0.5 text-[14px] leading-relaxed text-muted">Tell us when your current policy expires and we’ll remind you with better quotes.</p>
        </div>
      </div>
      {state.status === "error" && state.message && (
        <div ref={statusRef} tabIndex={-1} className="mt-4 focus:outline-none">
          <Notice tone="danger"><span role="alert">{state.message}</span></Notice>
        </div>
      )}
      <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label htmlFor={id("hp")}>Company website</label>
        <input id={id("hp")} name="company_website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input ref={startedRef} type="hidden" name="started_at" defaultValue="" />
      <input ref={pageRef} type="hidden" name="source_page" defaultValue="" />
      <input type="hidden" name="kind" value="customer" />
      <input type="hidden" name="tag" value="renewal_reminder" />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Type of policy" htmlFor={id("cat")} error={err.category_slug}>
          <Select id={id("cat")} name="category_slug" defaultValue={val.category_slug ?? defaultCategory ?? categories[0]?.slug ?? ""}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Current policy expires on" htmlFor={id("exp")} error={err.expires_on}>
          <Input id={id("exp")} name="expires_on" type="date" required defaultValue={val.expires_on} aria-invalid={!!err.expires_on} />
        </Field>
        <Field label="Your name" htmlFor={id("name")} error={err.name}>
          <Input id={id("name")} name="name" autoComplete="name" required defaultValue={val.name} aria-invalid={!!err.name} />
        </Field>
        <Field label="Phone or email" htmlFor={id("contact")} error={err.email ?? err.phone} hint="MoMo number or email — whichever you check.">
          <Input id={id("contact")} name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="024 123 4567" defaultValue={val.phone} aria-invalid={!!(err.email ?? err.phone)} />
        </Field>
        <Field label={<>Email <span className="font-normal text-subtle">(optional)</span></>} htmlFor={id("email")} className="sm:col-span-2">
          <Input id={id("email")} name="email" type="email" autoComplete="email" inputMode="email" defaultValue={val.email} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            name="consent"
            required
            defaultChecked={val.consent !== undefined ? val.consent === "on" : true}
            aria-invalid={!!err.consent}
            label={<>Remind me by SMS, WhatsApp or email before my policy ends. See the <Link href="/legal/privacy" className="font-medium text-brand underline-offset-2 hover:underline">privacy notice</Link>.</>}
          />
          {err.consent && <p className="mt-1.5 text-xs text-danger">{err.consent}</p>}
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-subtle">One reminder, no spam. Unsubscribe any time.</p>
        <Button type="submit" size="md" loading={pending}>{pending ? "Saving…" : "Remind me"}</Button>
      </div>
    </form>
  );
}
