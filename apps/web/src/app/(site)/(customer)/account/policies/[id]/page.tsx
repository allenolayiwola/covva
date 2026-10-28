import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftRight, Camera, Check, FileText, Gauge, Mail, PenLine, Phone, QrCode as QrIcon, RefreshCw, TrendingUp, X } from "lucide-react";
import { CLAIM_STATUS, POLICY_STATUS, buildDisclosure, daysUntil, formatDate, formatGHS, humanize, verifyUrl } from "@im/core";
import type { Row } from "@im/db";
import { Card, DefinitionList, DemoBadge, DisclosureBlock, Notice, Pill, StatusPill, buttonClass } from "@im/ui";
import { getFlags } from "@/lib/catalog";
import { BrokerRow, brokerContact } from "@/components/customer/broker-card";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UploadDropzone } from "@/components/customer/upload";
import { formatBytes } from "@/components/customer/utils";
import { QrCode } from "@/components/marketing/qr-code";
import { TransactionParties } from "@/components/transaction-parties";
import { account, coverLabel, getPolicyOr404, policyTitle, signUrls } from "../../_lib/data";
import { attachPolicyDocument } from "../actions";
import { RenameForm } from "./rename-form";
import { PropertyUpdatesCard } from "@/components/customer/property-updates";
import { isPropertyCategory } from "@/server/property";
import { InstalmentBlock } from "@/components/customer/instalment-block";
import { PolicyChangesSection } from "@/components/customer/policy-changes";
import { PolicyExplainerSection } from "@/components/customer/policy-explainer-section";

export const metadata: Metadata = { title: "Policy" };

export default function PolicyPage({ params, searchParams }: PageProps<"/account/policies/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton hero rows={4} />}>
      <PolicyDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

type Coverage = { key: string; label: string; included: boolean; detail?: string }[];

async function PolicyDetail({ params, searchParams }: Pick<PageProps<"/account/policies/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, supabase } = await account(`/account/policies/${id}`);
  const policy = await getPolicyOr404(supabase, id);

  // Diaspora: the policy may be paid for by a sponsor abroad (beneficiary side) or cover a family member (sponsor side).
  const sponsored = !!policy.sponsor_user_id && policy.sponsor_user_id !== user.id;
  const [docsRes, quoteRes, versionRes, claimsRes, flags, sponsorNameRes, sponsorshipRes, beneficiaryRes] = await Promise.all([
    supabase.from("documents").select("id, file_name, storage_path, kind, size_bytes, created_at, uploaded_by_party").eq("policy_id", id).order("created_at", { ascending: false }),
    policy.quote_id
      ? supabase.from("quotes").select("coverage, exclusions, key_exclusion, limits, excesses, waiting_period_days").eq("id", policy.quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    policy.product_version_id
      ? supabase.from("product_versions").select("coverage, exclusions, key_exclusion, limits, excesses, waiting_period_days, claims_process").eq("id", policy.product_version_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("claims").select("id, reference, status, incident_type, created_at").eq("policy_id", id).order("created_at", { ascending: false }),
    getFlags(),
    sponsored ? supabase.rpc("policy_sponsor_name", { p_policy_id: id }) : Promise.resolve({ data: null as string | null }),
    policy.sponsor_user_id ? supabase.from("sponsorships").select("id, gift, gift_revealed_at, sponsor_user_id").eq("policy_id", id).maybeSingle() : Promise.resolve({ data: null }),
    policy.beneficiary_id && policy.sponsor_user_id === user.id ? supabase.from("beneficiaries").select("id, full_name").eq("id", policy.beneficiary_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const sponsorFirstName = sponsorNameRes.data ?? null;
  const sponsorship = sponsorshipRes.data as { id: string; gift: boolean; gift_revealed_at: string | null; sponsor_user_id: string } | null;
  const beneficiary = beneficiaryRes.data as { id: string; full_name: string } | null;
  const docs = docsRes.data ?? [];
  const terms = (quoteRes.data ?? versionRes.data) as Partial<Row<"quotes">> | null;
  const version = versionRes.data as (Partial<Row<"product_versions">> & { claims_process?: string | null }) | null;
  const claims = claimsRes.data ?? [];
  const urls = await signUrls(supabase, docs.map((d) => d.storage_path));

  const coverage = (Array.isArray(terms?.coverage) ? terms.coverage : []) as unknown as Coverage;
  const exclusions = terms?.exclusions ?? [];
  const limits = (terms?.limits ?? {}) as Record<string, unknown>;
  const days = policy.status === "active" ? daysUntil(policy.cover_end) : null;
  const insurer = policy.insurer;
  const broker = policy.broker;
  const bc = brokerContact(broker);
  const isDemo = !!flags.demo_mode && !!(insurer?.settings as { demo?: boolean } | null)?.demo;
  const disclosure = broker
    ? buildDisclosure({ broker: { name: broker.name, licence: broker.nic_licence_number }, insurer: insurer ? { name: insurer.name } : null })
    : null;
  const title = policyTitle(policy);
  // Generated documents (schedule / certificate / sticker / receipt) live under policies/<id>/ and carry the verification QR.
  const generated = docs.filter((d) => d.storage_path.startsWith(`policies/${policy.id}/`));
  const sticker = generated.find((d) => d.kind === "sticker");
  const verifyLink = policy.verification_code && !policy.external_source ? verifyUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "", policy.verification_code) : null;
  const messageHref = policy.request_id ? `/account/requests/${policy.request_id}/messages` : "/account/messages";
  const underinsured = (policy.underinsurance_flag ?? null) as { reason?: string; suggested_sum_insured?: number; current_value?: number } | null;

  return (
    <div>
      <Breadcrumbs items={[{ label: "My policies", href: "/account/policies" }, { label: title }]} />
      {sp.added && <Notice tone="ok" className="mb-5">Policy added to your wallet. It&apos;s marked “Added by you” because it wasn&apos;t arranged here.</Notice>}

      <div className="relative overflow-hidden rounded-card bg-brand-dark p-6 text-white sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-12 size-64 rounded-full bg-white/8" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 right-24 size-56 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/75">{coverLabel(policy.category?.name, policy.insured_items as Record<string, unknown>)}</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-sm font-medium">
              {policy.status === "active" && <Check aria-hidden className="size-4" />}
              {POLICY_STATUS[policy.status].label}
            </span>
          </div>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight sm:text-[32px]">{title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-white/85">
            {insurer?.brand_color && <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: insurer.brand_color }} />}
            {insurer?.name ?? policy.external_insurer_name ?? "Insurer not listed"} · Policy {policy.policy_number ?? policy.internal_reference}
            {isDemo && <span className="rounded bg-white/15 px-1.5 text-[11px]">Demo</span>}
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-white/70">Cover starts</dt>
              <dd className="text-lg font-semibold">{formatDate(policy.cover_start)}</dd>
            </div>
            <div>
              <dt className="text-sm text-white/70">Cover ends</dt>
              <dd className="text-lg font-semibold">{formatDate(policy.cover_end)}</dd>
            </div>
            <div>
              <dt className="text-sm text-white/70">Premium</dt>
              <dd className="text-lg font-semibold">{policy.premium ? `${formatGHS(Number(policy.premium))} / ${policy.billing_period === "month" ? "mo" : "yr"}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-white/70">Sum insured</dt>
              <dd className="text-lg font-semibold">{policy.sum_insured ? formatGHS(Number(policy.sum_insured)) : "—"}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <a href="#documents" className="flex flex-col items-center gap-2 rounded-card bg-mist px-3 py-4 text-sm font-medium text-brand-deep hover:bg-mint-2">
          <FileText aria-hidden className="size-5" /> Documents
        </a>
        <Link href={`/account/claims/new?policy=${policy.id}`} className="flex flex-col items-center gap-2 rounded-card bg-mist px-3 py-4 text-sm font-medium text-brand-deep hover:bg-mint-2">
          <Camera aria-hidden className="size-5" /> Report claim
        </Link>
        {bc?.phone ? (
          <a href={`tel:${bc.phone.replace(/\s+/g, "")}`} className="flex flex-col items-center gap-2 rounded-card bg-mist px-3 py-4 text-sm font-medium text-brand-deep hover:bg-mint-2">
            <Phone aria-hidden className="size-5" /> Call broker
          </a>
        ) : (
          <Link href={messageHref} className="flex flex-col items-center gap-2 rounded-card bg-mist px-3 py-4 text-sm font-medium text-brand-deep hover:bg-mint-2">
            <Phone aria-hidden className="size-5" /> Contact broker
          </Link>
        )}
      </div>

      {sponsored && (
        <Notice tone="info" className="mt-6" title={sponsorship?.gift ? `A gift from ${sponsorFirstName ?? "a family member"}` : `Paid for by ${sponsorFirstName ?? "a family member"}`}>
          {sponsorship?.gift && !sponsorship.gift_revealed_at ? (
            <>
              There is a message waiting for you. <Link href={`/account/gifts/${sponsorship.id}`} className="font-medium text-brand hover:underline">Open your gift</Link>
            </>
          ) : (
            <>Your sponsor pays the premium and gets the same reminders and documents. You are the person covered and can report claims yourself.</>
          )}
        </Notice>
      )}
      {beneficiary && (
        <Notice tone="info" className="mt-6" title={`Covers ${beneficiary.full_name}`}>
          You pay for this policy for a family member in Ghana. Manage consent, gifts and claims on their behalf under{" "}
          <Link href={`/account/family/beneficiaries/${beneficiary.id}`} className="font-medium text-brand hover:underline">Family</Link>.
        </Notice>
      )}
      {policy.status === "pending_issuance" && <Notice tone="wait" className="mt-6" title="Not active yet">{POLICY_STATUS.pending_issuance.customerHint}</Notice>}
      {policy.external_source && (
        <Notice tone="info" className="mt-6" title="Added by you">
          This policy was bought elsewhere. We show what you entered; the insurer hasn&apos;t confirmed it here. Contact the insurer or your broker for claims.
        </Notice>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-8">
          <InstalmentBlock policyId={policy.id} />
          {days !== null && days >= 0 && days <= 60 && (
            <Card className="flex flex-wrap items-center gap-4 p-5">
              <span className="grid size-11 place-items-center rounded-xl bg-amber-bg text-amber">
                <RefreshCw aria-hidden className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">Renewal in {days} day{days === 1 ? "" : "s"}</p>
                <p className="text-sm text-muted">Review your needs with your broker before {formatDate(policy.cover_end)}.</p>
              </div>
              <Link href={`/account/policies/${policy.id}/renew`} className={buttonClass("primary", "sm")}>Review renewal</Link>
            </Card>
          )}

          {underinsured && policy.status === "active" && (
            <Card className="flex flex-wrap items-center gap-4 border-amber/40 p-5" aria-label="Underinsurance notice">
              <span className="grid size-11 place-items-center rounded-xl bg-amber-bg text-amber">
                <TrendingUp aria-hidden className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">
                  Your {policy.category?.slug === "motor" ? "car" : policy.category?.slug === "home" ? "home" : "property"} may be insured for less than it&apos;s worth
                </p>
                <p className="text-sm text-muted">
                  {underinsured.reason ?? "The sum insured is below the value you declared."}
                  {underinsured.suggested_sum_insured ? ` Consider raising it to about ${formatGHS(underinsured.suggested_sum_insured)}.` : ""} The insurer confirms any change.
                </p>
              </div>
              <Link href={`/account/requests/new?type=endorsement&policy=${policy.id}`} className={buttonClass("secondary", "sm")}>Ask to raise it</Link>
            </Card>
          )}

          <section aria-labelledby="cover">
            <h2 id="cover" className="text-lg font-semibold text-ink">What&apos;s covered</h2>
            {coverage.length ? (
              <ul className="mt-3 divide-y divide-line rounded-card border border-line">
                {coverage.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 px-4 py-3 text-sm">
                    {c.included ? <Check aria-label="Included" className="mt-0.5 size-4 shrink-0 text-brand" /> : <X aria-label="Not included" className="mt-0.5 size-4 shrink-0 text-subtle" />}
                    <span className={c.included ? "text-ink" : "text-muted"}>
                      {c.label}
                      {c.detail && <span className="block text-xs text-muted">{c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Your policy schedule lists exactly what is covered. Check the documents below.</p>
            )}
            {(Object.keys(limits).length > 0 || policy.excess != null || (terms?.waiting_period_days ?? 0) > 0) && (
              <DefinitionList
                className="mt-4"
                items={[
                  ...(policy.excess != null ? [{ label: "Main excess", value: formatGHS(Number(policy.excess)) }] : []),
                  ...Object.entries(limits)
                    .filter(([k]) => k !== "currency_note")
                    .map(([k, v]) => ({ label: humanize(k), value: typeof v === "number" && !/days|months|percent|members/i.test(k) ? formatGHS(v) : String(v) })),
                  ...((terms?.waiting_period_days ?? 0) > 0 ? [{ label: "Waiting period", value: `${terms!.waiting_period_days} days` }] : []),
                ]}
              />
            )}
          </section>

          {exclusions.length > 0 && (
            <section aria-labelledby="excl">
              <h2 id="excl" className="text-lg font-semibold text-ink">What&apos;s not covered</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
                {exclusions.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-subtle">Key exclusions only. The full policy wording applies.</p>
            </section>
          )}

          <Suspense fallback={<div className="h-40 animate-pulse rounded-card bg-mist" aria-hidden />}>
            <PolicyExplainerSection supabase={supabase} userId={user.id} policyId={policy.id} isDemo={isDemo} />
          </Suspense>

          {policy.category?.slug === "motor" && !policy.external_source && policy.customer_id === user.id && (
            <Card className="flex flex-wrap items-center gap-4 p-5" aria-label="Driving score">
              <span className="grid size-11 place-items-center rounded-xl bg-mint text-brand">
                <Gauge aria-hidden className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">Driving score (optional)</p>
                <p className="text-sm text-muted">Share trip summaries from your phone — never a GPS route — and {insurer?.name ?? "your insurer"} can reward safe driving at renewal. Stop at any time.</p>
              </div>
              <Link href="/account/telematics" className={buttonClass("secondary", "sm")}>Driving score</Link>
            </Card>
          )}

          {isPropertyCategory(policy.category?.slug) && !policy.external_source && <PropertyUpdatesCard policyId={policy.id} userId={user.id} supabase={supabase} />}

          <section id="documents" aria-labelledby="docs-h" className="scroll-mt-24">
            <h2 id="docs-h" className="text-lg font-semibold text-ink">Documents</h2>
            {docs.length ? (
              <ul className="mt-3 divide-y divide-line rounded-card border border-line">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <FileText aria-hidden className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      {urls[d.storage_path] ? (
                        <a href={urls[d.storage_path]} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-ink hover:text-brand hover:underline">{d.file_name}</a>
                      ) : (
                        <span className="block truncate font-medium text-ink">{d.file_name}</span>
                      )}
                      <span className="block text-xs text-subtle">{[humanize(d.kind), formatBytes(d.size_bytes), formatDate(d.created_at)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {d.storage_path.startsWith(`policies/${policy.id}/`) ? <Pill tone="ok">Issued · QR verified</Pill> : d.uploaded_by_party === "insurer" && <Pill tone="ok">From insurer</Pill>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">
                {policy.status === "pending_issuance" ? "Your schedule and certificate appear here once the insurer issues them." : "No documents yet."}
              </p>
            )}
            <UploadDropzone
              className="mt-3"
              userId={user.id}
              scope="policies"
              title={policy.external_source ? "Upload your policy schedule or certificate" : "Add a document to this policy"}
              buttonLabel="Upload"
              compact
              action={attachPolicyDocument.bind(null, policy.id)}
            />
          </section>

          {claims.length > 0 && (
            <section aria-labelledby="claims-h">
              <h2 id="claims-h" className="text-lg font-semibold text-ink">Claims on this policy</h2>
              <ul className="mt-3 divide-y divide-line rounded-card border border-line">
                {claims.map((c) => (
                  <li key={c.id}>
                    <Link href={`/account/claims/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-mist/50">
                      <span>
                        <span className="font-medium text-ink">{humanize(c.incident_type)}</span>
                        <span className="text-muted"> · {c.reference} · {formatDate(c.created_at)}</span>
                      </span>
                      <StatusPill meta={CLAIM_STATUS[c.status]} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <PolicyChangesSection supabase={supabase} policy={policy} />

          <section aria-labelledby="manage" className="space-y-3">
            <h2 id="manage" className="text-lg font-semibold text-ink">Manage this policy</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link href={`/account/policies/${policy.id}/renew`} className="flex items-start gap-3 rounded-card border border-line p-4 hover:border-brand">
                <RefreshCw aria-hidden className="mt-0.5 size-5 text-brand" />
                <span>
                  <span className="block font-medium text-ink">Request renewal options</span>
                  <span className="block text-sm text-muted">Confirm what&apos;s changed; your broker prepares options.</span>
                </span>
              </Link>
              <Link href={`/account/requests/new?type=endorsement&policy=${policy.id}`} className="flex items-start gap-3 rounded-card border border-line p-4 hover:border-brand">
                <PenLine aria-hidden className="mt-0.5 size-5 text-brand" />
                <span>
                  <span className="block font-medium text-ink">Request a change</span>
                  <span className="block text-sm text-muted">New address, driver, vehicle or sum insured. The insurer confirms changes.</span>
                </span>
              </Link>
              <Link href={`/account/requests/new?type=switch&policy=${policy.id}`} className="flex items-start gap-3 rounded-card border border-line p-4 hover:border-brand sm:col-span-2">
                <ArrowLeftRight aria-hidden className="mt-0.5 size-5 text-brand" />
                <span>
                  <span className="block font-medium text-ink">Switch insurer</span>
                  <span className="block text-sm text-muted">
                    Starts a review with your broker. Your existing cover is not cancelled until the replacement is accepted, its start date is agreed and
                    payment is confirmed.
                  </span>
                </span>
              </Link>
            </div>
            <div className="pt-2">
              <RenameForm policyId={policy.id} current={policy.nickname ?? ""} />
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          {insurer && (
            <Card className="p-5">
              <p className="text-sm text-muted">Insurer</p>
              <p className="mt-1 font-semibold text-ink">{insurer.name}</p>
              <p className="text-xs text-muted">Underwrites and issues this policy and decides claims.</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {insurer.contact_phone && (
                  <li>
                    <a href={`tel:${insurer.contact_phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-2 text-brand hover:underline"><Phone aria-hidden className="size-4" />{insurer.contact_phone}</a>
                  </li>
                )}
                {insurer.contact_email && (
                  <li>
                    <a href={`mailto:${insurer.contact_email}`} className="inline-flex items-center gap-2 text-brand hover:underline"><Mail aria-hidden className="size-4" />{insurer.contact_email}</a>
                  </li>
                )}
                {insurer.nic_licence_number && <li className="text-xs text-subtle">NIC licence {insurer.nic_licence_number}</li>}
              </ul>
              {isDemo && <DemoBadge className="mt-3" />}
            </Card>
          )}
          {!insurer && policy.external_insurer_name && (
            <Card className="p-5">
              <p className="text-sm text-muted">Insurer</p>
              <p className="mt-1 font-semibold text-ink">{policy.external_insurer_name}</p>
              <p className="text-xs text-muted">Not on the platform. Contact them directly for claims and changes; we hold only what you entered.</p>
            </Card>
          )}
          {broker && (
            <Card className="p-5">
              <BrokerRow broker={broker} />
              <ul className="mt-3 space-y-1.5 text-sm">
                {bc?.phone && (
                  <li>
                    <a href={`tel:${bc.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-2 text-brand hover:underline"><Phone aria-hidden className="size-4" />{bc.phone}</a>
                  </li>
                )}
                {bc?.email && (
                  <li>
                    <a href={`mailto:${bc.email}`} className="inline-flex items-center gap-2 text-brand hover:underline"><Mail aria-hidden className="size-4" />{bc.email}</a>
                  </li>
                )}
                {bc?.hours && <li className="text-xs text-subtle">{bc.hours}</li>}
              </ul>
              <Link href={messageHref} className={buttonClass("secondary", "sm", "mt-4 w-full")}>Message {bc?.firstName}</Link>
            </Card>
          )}
          {version?.claims_process && (
            <Card className="p-5">
              <p className="font-semibold text-ink">How to claim</p>
              <p className="mt-1 text-sm text-ink-2">{version.claims_process}</p>
            </Card>
          )}
          {verifyLink && policy.status === "active" && (
            <Card className="p-5">
              <div className="flex items-start gap-4">
                <QrCode value={verifyLink} size={96} label={`QR code: verify policy ${policy.policy_number ?? policy.internal_reference}`} className="shrink-0 rounded-lg border border-line" />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{sticker ? "Motor insurance sticker" : "Verify this policy"}</p>
                  <p className="mt-1 text-sm text-muted">
                    {sticker ? "Show this QR code at a road check. " : ""}Anyone can scan it to confirm the policy is valid — they see the insurer, cover dates and type of cover, never your details.
                  </p>
                  <p className="mt-2 font-mono text-xs text-subtle">Code {policy.verification_code}{policy.sticker_number ? ` · Sticker ${policy.sticker_number}` : ""}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <Link href={`/verify?q=${encodeURIComponent(policy.verification_code!)}`} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"><QrIcon aria-hidden className="size-4" /> Verify this policy</Link>
                    {sticker && urls[sticker.storage_path] && <a href={urls[sticker.storage_path]} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">Download sticker (PDF)</a>}
                  </div>
                </div>
              </div>
            </Card>
          )}
          <TransactionParties
            stage="policy"
            insurers={insurer ? [{ name: insurer.name, nic_licence_number: insurer.nic_licence_number, settings: insurer.settings }] : []}
            externalInsurerName={policy.external_insurer_name}
            broker={broker ? { name: broker.name, nic_licence_number: broker.nic_licence_number } : null}
            productVersionId={policy.product_version_id}
            isDemo={isDemo}
          />
          {disclosure && <DisclosureBlock text={disclosure} />}
          <p className="text-xs text-subtle">Reference {policy.internal_reference}{policy.issued_at ? ` · Issued ${formatDate(policy.issued_at)}` : ""}</p>
        </aside>
      </div>
    </div>
  );
}
