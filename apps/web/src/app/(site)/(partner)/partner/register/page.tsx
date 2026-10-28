import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card, Checkbox, Field, Input, Notice, PageHeader, Pill, Select, Textarea, buttonClass, cn } from "@im/ui";
import {
  GHANA_REGIONS,
  MOMO_NETWORKS,
  NIC_LICENCE_CLASSES,
  STEP_LABELS,
  agreementHash,
  agreementText,
  applicationCompleteness,
  currentAgreement,
  formatDateTime,
  humanize,
  nextStep,
  stepsFor,
  type ApplicationStep,
  type PartnerApplicationType,
} from "@im/core";
import { getCategories, getPlans, getSetting } from "@/lib/catalog";
import { ActionForm } from "@/components/partner/action-form";
import { Skeleton } from "@/components/partner/ui";
import { getApplicant, parseType, registerPath, registrationOpen, toInput, type Application } from "./_lib";
import { ApplicationDocumentsUpload } from "./documents-upload";
import { recordDocuments, removeDocument, saveCommercial, saveCompany, saveContacts, saveIntegration, saveLicence, saveSettlement, signAgreement, submitApplication } from "./actions";

export const metadata: Metadata = { title: "Register" };

export default function RegisterPage({ searchParams }: PageProps<"/partner/register">) {
  return (
    <Suspense fallback={<RegisterSkeleton />}>
      <Register searchParams={searchParams} />
    </Suspense>
  );
}

function RegisterSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Skeleton className="h-72" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}

async function Register({ searchParams }: Pick<PageProps<"/partner/register">, "searchParams">) {
  const sp = await searchParams;
  const type = parseType(sp.type);
  if (!type) return <ChooseType />;
  if (!(await registrationOpen(type))) return <Closed type={type} />;

  const { application } = await getApplicant(type);
  if (application && (application.status === "submitted" || application.status === "in_review")) redirect("/partner/register/status");

  const steps = stepsFor(type);
  const input = application ? toInput(application) : { type };
  const completeness = applicationCompleteness(input);
  const requested = typeof sp.step === "string" && (steps as string[]).includes(sp.step) ? (sp.step as ApplicationStep) : null;
  const step: ApplicationStep = requested ?? (application ? nextStep(input) : "company");
  const doneSteps = new Set(steps.filter((s) => s !== "review" && !completeness.missing.some((m) => m.step === s)));
  const title = type === "insurer" ? "Register as an Insurer" : "Register as a Broker";

  return (
    <>
      <PageHeader
        eyebrow="Covva partners"
        title={title}
        description="Save as you go. Our partnerships team verifies your NIC licence and documents before your workspace goes live."
        actions={application ? <Link href="/partner/register/status" className={buttonClass("outline", "sm")}>Application status</Link> : undefined}
      />
      {application?.status === "needs_changes" && (
        <Notice tone="wait" title="Changes requested by Covva" className="mb-6">
          <p className="whitespace-pre-line">{application.review_notes}</p>
          <p className="mt-1 text-xs">Update the steps below and submit again from the review step.</p>
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Stepper type={type} steps={steps} current={step} done={doneSteps} enabled={!!application} />
        <Card className="p-6 sm:p-8">
          <StepBody type={type} step={step} application={application} completeness={completeness} />
        </Card>
      </div>
    </>
  );
}

function ChooseType() {
  return (
    <>
      <PageHeader eyebrow="Covva partners" title="Partner with Covva" description="Choose how your organisation works with us. Both registrations take about 20 minutes and can be saved part-way." />
      <div className="grid gap-4 sm:grid-cols-2">
        {(["insurer", "broker"] as const).map((t) => (
          <Card key={t} className="p-6">
            <h2 className="text-lg font-semibold text-ink">{t === "insurer" ? "I represent an insurer" : "I represent a broker"}</h2>
            <p className="mt-1 text-sm text-muted">
              {t === "insurer"
                ? "List your products, set integration levels per line, approve broker appointments and issue cover."
                : "Receive routed requests, place business with insurers that appoint you, and bring your existing clients on board."}
            </p>
            <Link href={registerPath(t)} className={cn(buttonClass("primary", "md"), "mt-4")}>
              {t === "insurer" ? "Register as an Insurer" : "Register as a Broker"}
            </Link>
          </Card>
        ))}
      </div>
    </>
  );
}

function Closed({ type }: { type: PartnerApplicationType }) {
  return (
    <>
      <PageHeader eyebrow="Covva partners" title={type === "insurer" ? "Insurer registration" : "Broker registration"} />
      <Notice tone="info" title="Self-service registration is not open right now">
        <p>Registrations are currently handled by our partnerships team while our NIC approval is finalised. Request a call and we will onboard you in person.</p>
        <Link href={type === "insurer" ? "/insurers#contact" : "/brokers#contact"} className={cn(buttonClass("primary", "sm"), "mt-3")}>
          Request a call
        </Link>
      </Notice>
    </>
  );
}

function Stepper({ type, steps, current, done, enabled }: { type: PartnerApplicationType; steps: ApplicationStep[]; current: ApplicationStep; done: Set<ApplicationStep>; enabled: boolean }) {
  return (
    <nav aria-label="Registration steps" className="lg:sticky lg:top-24 lg:self-start">
      <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {steps.map((s, i) => {
          const active = s === current;
          const isDone = done.has(s);
          const inner = (
            <>
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", isDone ? "bg-brand text-white" : active ? "bg-gold text-ink" : "bg-mist text-muted")}>
                {isDone ? "✓" : i + 1}
              </span>
              <span className="whitespace-nowrap">{STEP_LABELS[s]}</span>
            </>
          );
          const cls = cn("flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm", active ? "bg-mint font-semibold text-brand-deep" : "text-muted hover:bg-white hover:text-ink");
          return (
            <li key={s} className="shrink-0">
              {enabled || s === "company" ? (
                <Link href={registerPath(type, s)} aria-current={active ? "step" : undefined} className={cls}>
                  {inner}
                </Link>
              ) : (
                <span className={cn(cls, "opacity-60")} aria-disabled="true">{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
type Contact = { name?: string; email?: string; phone?: string; title?: string };
const contact = (v: unknown): Contact => (v && typeof v === "object" ? (v as Contact) : {});

async function StepBody({ type, step, application, completeness }: { type: PartnerApplicationType; step: ApplicationStep; application: Application | null; completeness: ReturnType<typeof applicationCompleteness> }) {
  const app = application;
  const hidden = (
    <>
      <input type="hidden" name="type" value={type} />
      {app && <input type="hidden" name="applicationId" value={app.id} />}
    </>
  );
  const heading = (title: string, hint: string) => (
    <div className="mb-5">
      <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </div>
  );
  if (!app && step !== "company") {
    return (
      <Notice tone="info">
        Start with your company details — the application is saved after the first step.{" "}
        <Link href={registerPath(type, "company")} className="font-medium text-brand hover:underline">Go to step 1</Link>
      </Notice>
    );
  }

  switch (step) {
    case "company":
      return (
        <>
          {heading("Company details", type === "insurer" ? "The insurer as licensed by the NIC." : "The brokerage as licensed by the NIC.")}
          <ActionForm action={saveCompany} submitLabel="Save and continue" pendingLabel="Saving…" size="md">
            {hidden}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trading name" htmlFor="company_name" className="sm:col-span-2"><Input id="company_name" name="company_name" defaultValue={app?.company_name ?? ""} required autoComplete="organization" /></Field>
              <Field label="Legal name (if different)" htmlFor="legal_name"><Input id="legal_name" name="legal_name" defaultValue={app?.legal_name ?? ""} /></Field>
              <Field label="Company registration number" htmlFor="registration_number" hint="Registrar General's Department"><Input id="registration_number" name="registration_number" defaultValue={app?.registration_number ?? ""} /></Field>
              <Field label="Registered address" htmlFor="address" className="sm:col-span-2"><Textarea id="address" name="address" defaultValue={app?.address ?? ""} required rows={2} /></Field>
              <Field label="Region" htmlFor="region">
                <Select id="region" name="region" defaultValue={app?.region ?? ""} required>
                  <option value="">Choose a region</option>
                  {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Website" htmlFor="website"><Input id="website" name="website" type="url" placeholder="https://" defaultValue={app?.website ?? ""} /></Field>
            </div>
          </ActionForm>
        </>
      );

    case "licence":
      return (
        <>
          {heading("NIC licence", "We verify this against the NIC register before you go live. Expiry is tracked and a lapsed licence suspends the organisation automatically.")}
          <ActionForm action={saveLicence} submitLabel="Save and continue" pendingLabel="Saving…" size="md">
            {hidden}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="NIC licence number" htmlFor="nic_licence_number" className="sm:col-span-2"><Input id="nic_licence_number" name="nic_licence_number" defaultValue={app?.nic_licence_number ?? ""} required /></Field>
              <Field label="Licence class" htmlFor="nic_licence_class">
                <Select id="nic_licence_class" name="nic_licence_class" defaultValue={app?.nic_licence_class ?? (type === "broker" ? "broker" : "")} required>
                  <option value="">Choose a class</option>
                  {NIC_LICENCE_CLASSES.filter((c) => (type === "broker" ? c === "broker" : c !== "broker")).map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </Select>
              </Field>
              <Field label="Licence expires on" htmlFor="nic_licence_expires_on"><Input id="nic_licence_expires_on" name="nic_licence_expires_on" type="date" defaultValue={app?.nic_licence_expires_on ?? ""} required /></Field>
            </div>
          </ActionForm>
        </>
      );

    case "contacts": {
      const primary = contact(app?.primary_contact);
      const second = contact(type === "insurer" ? app?.compliance_contact : app?.principal_officer);
      const block = (prefix: string, c: Contact, label: string) => (
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold text-ink">{label}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor={`${prefix}_name`}><Input id={`${prefix}_name`} name={`${prefix}_name`} defaultValue={c.name ?? ""} required /></Field>
            <Field label="Job title" htmlFor={`${prefix}_title`}><Input id={`${prefix}_title`} name={`${prefix}_title`} defaultValue={c.title ?? ""} /></Field>
            <Field label="Email" htmlFor={`${prefix}_email`}><Input id={`${prefix}_email`} name={`${prefix}_email`} type="email" defaultValue={c.email ?? ""} required /></Field>
            <Field label="Phone" htmlFor={`${prefix}_phone`}><Input id={`${prefix}_phone`} name={`${prefix}_phone`} type="tel" defaultValue={c.phone ?? ""} /></Field>
          </div>
        </fieldset>
      );
      return (
        <>
          {heading("Contacts", type === "insurer" ? "The primary contact receives onboarding updates; the compliance contact receives regulatory notices." : "The primary contact receives onboarding updates. The principal officer is the NIC-approved officer responsible for the brokerage.")}
          <ActionForm action={saveContacts} submitLabel="Save and continue" pendingLabel="Saving…" size="md" className="space-y-4">
            {hidden}
            {block("primary", primary, "Primary contact")}
            {block(type === "insurer" ? "compliance" : "officer", second, type === "insurer" ? "Compliance contact" : "Principal officer")}
          </ActionForm>
        </>
      );
    }

    case "settlement": {
      const acct = (app?.settlement_account ?? {}) as Record<string, string>;
      const kind = acct.type === "momo" ? "momo" : "bank";
      return (
        <>
          {heading("Settlement account", "Where your share of each premium (insurers) or your commission (brokers) is paid. Bank or mobile money only — we never store card details.")}
          <ActionForm action={saveSettlement} submitLabel="Save and continue" pendingLabel="Saving…" size="md" className="space-y-4">
            {hidden}
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-2 text-sm font-medium text-ink-2">Account type</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="account_type" value="bank" defaultChecked={kind === "bank"} className="accent-brand" /> Bank account</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="account_type" value="momo" defaultChecked={kind === "momo"} className="accent-brand" /> Mobile money</label>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank name" htmlFor="bank_name"><Input id="bank_name" name="bank_name" defaultValue={kind === "bank" ? (acct.bank_name ?? "") : ""} /></Field>
              <Field label="Account name" htmlFor="bank_account_name"><Input id="bank_account_name" name="bank_account_name" defaultValue={kind === "bank" ? (acct.account_name ?? "") : ""} /></Field>
              <Field label="Account number" htmlFor="account_number" className="sm:col-span-2"><Input id="account_number" name="account_number" inputMode="numeric" defaultValue={kind === "bank" ? (acct.account_number ?? "") : ""} /></Field>
            </div>
            <div className="grid gap-4 rounded-xl border border-line bg-mist/40 p-4 sm:grid-cols-3">
              <Field label="Mobile money network" htmlFor="momo_network">
                <Select id="momo_network" name="momo_network" defaultValue={kind === "momo" ? (acct.momo_network ?? "") : ""}>
                  <option value="">Choose</option>
                  {MOMO_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </Field>
              <Field label="Mobile money number" htmlFor="momo_number"><Input id="momo_number" name="momo_number" type="tel" defaultValue={kind === "momo" ? (acct.momo_number ?? "") : ""} /></Field>
              <Field label="Registered name" htmlFor="momo_account_name"><Input id="momo_account_name" name="momo_account_name" defaultValue={kind === "momo" ? (acct.account_name ?? "") : ""} /></Field>
            </div>
            <p className="text-xs text-subtle">Fill in the section that matches the account type you chose.</p>
          </ActionForm>
        </>
      );
    }

    case "documents": {
      const docs = (Array.isArray(app?.documents) ? app!.documents : []) as { kind: string; storage_path: string; name: string; uploaded_at: string }[];
      const kinds = [
        { value: "nic_licence", label: "NIC licence certificate" },
        { value: "incorporation", label: "Certificate of incorporation" },
        { value: "partner_agreement", label: "Signed partner agreement (optional — you also sign in-app)" },
        { value: "other", label: "Other supporting document" },
      ];
      return (
        <>
          {heading("Documents", "Upload the NIC licence and the certificate of incorporation. Files are private and only visible to you and Covva’s verification team.")}
          <ApplicationDocumentsUpload applicationId={app!.id} type={type} kinds={kinds} action={recordDocuments} />
          {docs.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
              {docs.map((d) => (
                <li key={d.storage_path} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{d.name}</p>
                    <p className="text-xs text-muted">{humanize(d.kind)} · {formatDateTime(d.uploaded_at)}</p>
                  </div>
                  <ActionForm action={removeDocument} submitLabel="Remove" variant="ghost" size="sm" inline>
                    {hidden}
                    <input type="hidden" name="path" value={d.storage_path} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-muted">{completeness.missing.filter((m) => m.step === "documents").map((m) => m.reason).join(" · ") || "Both required documents are uploaded."}</p>
            <Link href={registerPath(type, nextStep({ ...toInput(app!) }, "documents"))} className={buttonClass("primary", "md")}>Continue</Link>
          </div>
        </>
      );
    }

    case "integration": {
      const cats = await getCategories();
      const chosen = new Map(((app?.integration_levels ?? []) as { category_slug: string; level: string }[]).map((l) => [l.category_slug, l.level]));
      return (
        <>
          {heading("Integration level per product line", "L1 Portal: you quote and issue in the Covva portal. L2 Delegated issuance: brokers issue within your rules. L3 API: quotes and policies through your API. Covva confirms the level during onboarding.")}
          <ActionForm action={saveIntegration} submitLabel="Save and continue" pendingLabel="Saving…" size="md">
            {hidden}
            <div className="divide-y divide-line rounded-xl border border-line">
              {cats.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <label htmlFor={`level_${c.slug}`} className="text-sm font-medium text-ink">{c.name}</label>
                  <Select id={`level_${c.slug}`} name={`level_${c.slug}`} defaultValue={chosen.get(c.slug) ?? ""} className="h-9 w-48 text-sm">
                    <option value="">Not offered</option>
                    <option value="L1">L1 · Portal</option>
                    <option value="L2">L2 · Delegated issuance</option>
                    <option value="L3">L3 · API</option>
                  </Select>
                </div>
              ))}
            </div>
          </ActionForm>
        </>
      );
    }

    case "commercial": {
      const [plans, share] = await Promise.all([getPlans(), getSetting<number | string>("commercial.default_revenue_share_pct")]);
      const brokerPlans = plans.filter((p) => p.audience === "broker");
      return (
        <>
          {heading("Commercial model", "Choose how you pay for Covva. Either way, insurers pay your commission directly; Covva never holds premiums.")}
          <ActionForm action={saveCommercial} submitLabel="Save and continue" pendingLabel="Saving…" size="md" className="space-y-3">
            {hidden}
            <label className="flex cursor-pointer gap-3 rounded-xl border border-line p-4 has-[:checked]:border-brand has-[:checked]:bg-mint/40">
              <input type="radio" name="commercial_model" value="revenue_share" defaultChecked={(app?.commercial_model ?? "revenue_share") === "revenue_share"} className="mt-1 accent-brand" />
              <span>
                <span className="block font-semibold text-ink">Revenue share</span>
                <span className="block text-sm text-muted">No monthly fee. Covva keeps {share ?? 20}% of your commission on business Covva sends you. Clients you bring yourself: no share.</span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-xl border border-line p-4 has-[:checked]:border-brand has-[:checked]:bg-mint/40">
              <input type="radio" name="commercial_model" value="subscription" defaultChecked={app?.commercial_model === "subscription"} className="mt-1 accent-brand" />
              <span>
                <span className="block font-semibold text-ink">Subscription</span>
                <span className="block text-sm text-muted">A monthly plan and you keep your full commission. Plans: {brokerPlans.map((p) => `${p.name} (GHS ${Number(p.monthly_fee).toLocaleString()}/month)`).join(", ") || "agreed with the partnerships team"}.</span>
              </span>
            </label>
          </ActionForm>
        </>
      );
    }

    case "agreement": {
      const agreement = currentAgreement(type);
      const text = agreementText(agreement);
      const hash = await agreementHash(text);
      const signed = (app?.agreement ?? {}) as { signed_name?: string; signed_at?: string; version?: string; hash?: string };
      const alreadySigned = !!signed.signed_at && signed.hash === hash;
      return (
        <>
          {heading(agreement.title, "Read the agreement, then sign it by typing your name and confirming. We record the time, your IP address and a fingerprint of this exact text.")}
          <div className="max-h-96 space-y-4 overflow-y-auto rounded-xl border border-line bg-mist/40 p-4 text-sm leading-relaxed text-ink-2" tabIndex={0} aria-label="Partner agreement text">
            {agreement.sections.map((s) => (
              <section key={s.heading}>
                <h3 className="font-semibold text-ink">{s.heading}</h3>
                <p>{s.body}</p>
              </section>
            ))}
            <p className="text-xs text-subtle">Version {agreement.version} · SHA-256 {hash.slice(0, 16)}…</p>
          </div>
          {alreadySigned ? (
            <Notice tone="ok" className="mt-4" title={`Signed by ${signed.signed_name} on ${formatDateTime(signed.signed_at)}`}>
              <Link href={registerPath(type, "review")} className={cn(buttonClass("primary", "sm"), "mt-2")}>Continue to review</Link>
            </Notice>
          ) : (
            <ActionForm action={signAgreement} submitLabel="Sign agreement" pendingLabel="Signing…" size="md" className="mt-4 space-y-4">
              {hidden}
              <input type="hidden" name="hash" value={hash} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your full name (typed signature)" htmlFor="signed_name"><Input id="signed_name" name="signed_name" required autoComplete="name" /></Field>
                <Field label="Your title" htmlFor="signed_title"><Input id="signed_title" name="signed_title" placeholder="e.g. Managing Director" /></Field>
              </div>
              <Checkbox name="consent" label="I have read the agreement, I am authorised to sign for my organisation, and I agree to be bound by it." required />
            </ActionForm>
          )}
        </>
      );
    }

    case "review": {
      const a = app!;
      const primary = contact(a.primary_contact);
      const rows: [string, React.ReactNode][] = [
        ["Company", a.company_name],
        ["Registered address", `${a.address ?? ""}${a.region ? `, ${a.region}` : ""}`],
        ["NIC licence", a.nic_licence_number ? `${a.nic_licence_number} · ${humanize(a.nic_licence_class ?? "")} · expires ${a.nic_licence_expires_on ?? "—"}` : "—"],
        ["Primary contact", primary.name ? `${primary.name} · ${primary.email ?? ""}` : "—"],
        ["Settlement account", (a.settlement_account as { type?: string })?.type === "momo" ? "Mobile money" : (a.settlement_account as { type?: string })?.type === "bank" ? "Bank account" : "—"],
        ["Documents", `${(Array.isArray(a.documents) ? a.documents.length : 0)} uploaded`],
        type === "insurer"
          ? ["Integration levels", ((a.integration_levels ?? []) as { category_slug: string; level: string }[]).map((l) => `${l.category_slug}: ${l.level}`).join(", ") || "—"]
          : ["Commercial model", a.commercial_model ? humanize(a.commercial_model) : "—"],
        ["Agreement", (a.agreement as { signed_at?: string })?.signed_at ? `Signed ${formatDateTime((a.agreement as { signed_at: string }).signed_at)}` : "Not signed"],
      ];
      return (
        <>
          {heading("Review and submit", "Check everything is right. After you submit, the application is locked while Covva reviews it; we will return it to you if anything needs changing.")}
          <dl className="divide-y divide-line rounded-xl border border-line">
            {rows.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[200px_1fr]">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium text-ink">{v || "—"}</dd>
              </div>
            ))}
          </dl>
          {completeness.missing.length > 0 ? (
            <Notice tone="wait" className="mt-4" title="Still to do before you can submit">
              <ul className="list-disc space-y-1 pl-5">
                {completeness.missing.map((m, i) => (
                  <li key={i}>
                    <Link href={registerPath(type, m.step)} className="font-medium text-brand hover:underline">{m.label}</Link>: {m.reason}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : (
            <Notice tone="ok" className="mt-4">Everything is complete. <Pill tone="ok" className="ml-1">Ready to submit</Pill></Notice>
          )}
          <ActionForm action={submitApplication} submitLabel="Submit application" pendingLabel="Submitting…" size="md" className="mt-4" confirm="Submit your application for verification? You won't be able to edit it until Covva responds.">
            {hidden}
          </ActionForm>
        </>
      );
    }
  }
}
