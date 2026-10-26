"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Button, Checkbox, Field, Input, Notice, Select, Textarea, cn } from "@im/ui";
import { submitLead, type LeadState } from "@/app/(marketing)/actions";
import type { LeadTag } from "./lead-tags";

type Kind = "customer" | "broker" | "insurer" | "enterprise" | "press" | "other";

const KIND_LABELS: Record<Kind, string> = {
  customer: "I’m looking for cover",
  broker: "I’m a broker",
  insurer: "I represent an insurer",
  enterprise: "Business, employer or group",
  press: "Press or media",
  other: "Something else",
};

const INITIAL: LeadState = { status: "idle" };

export interface LeadFormProps {
  /** Fixed enquiry type. Omit to let the person choose. */
  kind?: Kind;
  kindOptions?: Kind[];
  defaultKind?: Kind;
  organization?: "required" | "optional" | "hidden";
  organizationLabel?: string;
  topicLabel?: string;
  topics?: { value: string; label: string }[];
  defaultTopic?: string;
  messageLabel?: string;
  messagePlaceholder?: string;
  submitLabel?: string;
  successTitle?: string;
  successBody?: string;
  className?: string;
  /** Campaign tag stored with the lead (see lead-tags.ts). */
  tag?: LeadTag;
}

/**
 * One reusable enquiry form for partner, business and contact pages. Posts to the
 * `submitLead` Server Action (zod-validated, inserted into `public.leads` under RLS).
 * Includes a honeypot field and a minimum fill time to discard automated submissions.
 * Remounting (via `key`) after "Send another message" resets the action state.
 */
export function LeadForm(props: LeadFormProps) {
  const [instance, setInstance] = React.useState(0);
  return <LeadFormInstance key={instance} {...props} onReset={() => setInstance((n) => n + 1)} />;
}

function LeadFormInstance({
  kind,
  kindOptions = ["customer", "broker", "insurer", "enterprise", "press", "other"],
  defaultKind,
  organization = "optional",
  organizationLabel = "Organisation",
  topicLabel,
  topics,
  defaultTopic,
  messageLabel = "How can we help?",
  messagePlaceholder,
  submitLabel = "Send message",
  successTitle = "Thank you — we’ve got your message.",
  successBody = "Someone from our team will reply within two working days. If your enquiry is about an existing policy or claim, your broker is the fastest route.",
  className,
  tag,
  onReset,
}: LeadFormProps & { onReset: () => void }) {
  const [state, formAction, pending] = useActionState(submitLead, INITIAL);
  const startedRef = React.useRef<HTMLInputElement>(null);
  const pageRef = React.useRef<HTMLInputElement>(null);
  const utmRef = React.useRef<HTMLInputElement>(null);
  const topicRef = React.useRef<HTMLSelectElement>(null);
  const uid = React.useId();
  const id = (f: string) => `${uid}-${f}`;
  const err = state.fieldErrors ?? {};
  const val = state.values ?? {};
  const [selectedKind, setSelectedKind] = React.useState<Kind>(kind ?? defaultKind ?? kindOptions[0] ?? "customer");
  const effectiveKind = kind ?? selectedKind;
  const orgMode = organization === "hidden" ? "hidden" : ["broker", "insurer", "enterprise"].includes(effectiveKind) ? "required" : organization;
  const successRef = React.useRef<HTMLDivElement>(null);
  const statusRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Bot guard + attribution written straight to the hidden inputs (DOM only, no state → no re-render).
    if (startedRef.current) startedRef.current.value = String(Date.now());
    if (pageRef.current) pageRef.current.value = window.location.pathname;
    if (utmRef.current) utmRef.current.value = window.location.search.slice(0, 1000);
    // Pre-select a topic passed as ?topic=slug (e.g. "Register interest" links from category pages).
    const fromUrl = new URLSearchParams(window.location.search).get("topic");
    if (fromUrl && topicRef.current && topics?.some((t) => t.value === fromUrl)) topicRef.current.value = fromUrl;
  }, [topics]);

  React.useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
    if (state.status === "error") statusRef.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className={cn("rounded-card border border-line bg-white p-8 text-center focus:outline-none sm:p-10", className)}>
        <span aria-hidden className="mx-auto grid size-14 place-items-center rounded-full bg-mint text-brand">
          <CircleCheck className="size-7" />
        </span>
        <p className="mt-5 text-xl font-semibold tracking-tight text-ink">{successTitle}</p>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">{successBody}</p>
        <button
          type="button"
          onClick={onReset}
          className="mt-6 rounded text-sm font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className={cn("relative rounded-card border border-line bg-white p-6 sm:p-8", className)}>
      {state.status === "error" && state.message && (
        <div ref={statusRef} tabIndex={-1} className="mb-6 focus:outline-none">
          <Notice tone="danger">
            <span role="alert">{state.message}</span>
          </Notice>
        </div>
      )}

      {/* Honeypot: off-screen and hidden from assistive tech; automated submitters tend to fill it. */}
      <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label htmlFor={id("hp")}>Company website</label>
        <input id={id("hp")} name="company_website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input ref={startedRef} type="hidden" name="started_at" defaultValue="" />
      <input ref={pageRef} type="hidden" name="source_page" defaultValue="" />
      <input ref={utmRef} type="hidden" name="utm" defaultValue="" />
      {kind && <input type="hidden" name="kind" value={kind} />}
      {tag && <input type="hidden" name="tag" value={tag} />}

      <div className="grid gap-5 sm:grid-cols-2">
        {!kind && (
          <Field label="What is this about?" htmlFor={id("kind")} error={err.kind} className="sm:col-span-2">
            <Select id={id("kind")} name="kind" value={selectedKind} onChange={(e) => setSelectedKind(e.target.value as Kind)}>
              {kindOptions.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Your name" htmlFor={id("name")} error={err.name}>
          <Input id={id("name")} name="name" autoComplete="name" required defaultValue={val.name} aria-invalid={!!err.name} />
        </Field>
        {orgMode !== "hidden" ? (
          <Field
            label={<>{organizationLabel}{orgMode === "optional" && <span className="font-normal text-subtle"> (optional)</span>}</>}
            htmlFor={id("org")}
            error={err.organization}
          >
            <Input id={id("org")} name="organization" autoComplete="organization" required={orgMode === "required"} defaultValue={val.organization} aria-invalid={!!err.organization} />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Email" htmlFor={id("email")} error={err.email} hint="We’ll reply here. Or leave a phone number.">
          <Input id={id("email")} name="email" type="email" autoComplete="email" inputMode="email" defaultValue={val.email} aria-invalid={!!err.email} />
        </Field>
        <Field label={<>Phone <span className="font-normal text-subtle">(optional)</span></>} htmlFor={id("phone")} error={err.phone}>
          <Input id={id("phone")} name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="024 123 4567" defaultValue={val.phone} aria-invalid={!!err.phone} />
        </Field>
        {topics && topics.length > 0 && (
          <Field label={topicLabel ?? "Topic"} htmlFor={id("topic")} error={err.category_slug} className="sm:col-span-2">
            <Select ref={topicRef} id={id("topic")} name="category_slug" defaultValue={val.category_slug ?? defaultTopic ?? ""}>
              <option value="">Choose one (optional)</option>
              {topics.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={messageLabel} htmlFor={id("message")} error={err.message} className="sm:col-span-2">
          <Textarea id={id("message")} name="message" rows={5} placeholder={messagePlaceholder} defaultValue={val.message} aria-invalid={!!err.message} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            name="consent"
            required
            defaultChecked={val.consent === "on"}
            aria-invalid={!!err.consent}
            label={
              <>
                You may contact me about this enquiry. I have read the{" "}
                <Link href="/legal/privacy" className="font-medium text-brand underline-offset-2 hover:underline">privacy notice</Link>.
              </>
            }
          />
          {err.consent && <p className="mt-1.5 text-xs text-danger">{err.consent}</p>}
        </div>
      </div>

      <div className="mt-7 flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-subtle">Please don’t include medical details, ID numbers or card details.</p>
        <Button type="submit" size="lg" loading={pending}>
          {pending ? "Sending…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
