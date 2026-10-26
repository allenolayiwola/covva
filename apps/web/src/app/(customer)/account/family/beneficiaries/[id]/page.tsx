import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Camera, Gift, Shield } from "lucide-react";
import { CONSENT_KIND_META, CONSENT_STATUS, POLICY_STATUS, consentGranted, formatDate, formatDateTime, formatGHS, relationshipLabel, type ConsentKind } from "@im/core";
import { Card, DefinitionList, Notice, PageHeader, Pill, StatusPill, buttonClass } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { getBeneficiary, listConsents } from "@/server/diaspora";
import { UUID_RE, account } from "../../../_lib/data";
import { BeneficiaryForm } from "../new/beneficiary-form";
import { ConsentPanel } from "./consent-panel";
import { LinkPolicyForm, SponsorshipForm } from "./sponsorship-form";

export const metadata: Metadata = { title: "Family member" };

export default function BeneficiaryPage({ params, searchParams }: PageProps<"/account/family/beneficiaries/[id]">) {
  return (
    <div className="max-w-3xl">
      <Suspense fallback={<PageSkeleton hero rows={4} />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ params, searchParams }: Pick<PageProps<"/account/family/beneficiaries/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const { user, supabase } = await account(`/account/family/beneficiaries/${id}`);
  const b = await getBeneficiary(supabase, user.id, id);
  if (!b) notFound();
  const [consents, { data: sponsorships }, { data: policies }, { data: ownPolicies }] = await Promise.all([
    listConsents(supabase, b.id),
    supabase.from("sponsorships").select("*").eq("beneficiary_id", b.id).eq("sponsor_user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("policies").select("id, nickname, summary, policy_number, internal_reference, status, cover_end, premium, billing_period, category:product_categories(name)").eq("beneficiary_id", b.id).order("cover_end", { ascending: false, nullsFirst: false }),
    supabase.from("policies").select("id, nickname, summary, policy_number, internal_reference, status, beneficiary_id, category:product_categories(name)").eq("customer_id", user.id).is("beneficiary_id", null).in("status", ["active", "pending_issuance"]),
  ]);
  const meta = CONSENT_STATUS[b.consent_status as keyof typeof CONSENT_STATUS] ?? CONSENT_STATUS.pending;
  const dataConsent = consentGranted(consents, "data_sharing");
  const proxyConsent = consentGranted(consents, "proxy_claims");
  const first = b.full_name.split(/\s+/)[0] ?? b.full_name;
  const sponsorshipByPolicy = new Map((sponsorships ?? []).filter((s) => s.policy_id).map((s) => [s.policy_id!, s]));
  const consentState = (kind: ConsentKind) => {
    const c = consents.find((x) => x.kind === kind);
    return { kind, granted: !!c?.granted, grantedAt: c?.granted_at ?? null, declinedAt: c?.declined_at ?? null, requestedAt: c?.requested_at ?? null, expiresAt: c?.expires_at ?? null, locked: !!c?.locked_at, channel: c?.channel ?? null };
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Family", href: "/account/family" }, { label: b.full_name }]} />
      <PageHeader
        eyebrow={relationshipLabel(b.relationship)}
        title={b.full_name}
        description={`${b.phone}${b.has_account ? " · has their own Covva account" : ""}`}
        actions={<Pill tone={meta.tone}>{meta.label}</Pill>}
      />
      {sp.added && <Notice tone="ok" className="mb-5">{first} added. Send the consent code below so they can agree to cover being arranged for them.</Notice>}

      <section aria-labelledby="consent-h" className="mb-8">
        <h2 id="consent-h" className="mb-1 text-lg font-semibold text-ink">Consent</h2>
        <p className="mb-4 text-sm text-muted">{meta.hint}</p>
        <div className="space-y-4">
          <ConsentPanel beneficiaryId={b.id} beneficiaryName={first} kind="data_sharing" title={CONSENT_KIND_META.data_sharing.title} summary="Needed before you can request quotes for them." state={consentState("data_sharing")} />
          <ConsentPanel beneficiaryId={b.id} beneficiaryName={first} kind="proxy_claims" title={CONSENT_KIND_META.proxy_claims.title} summary="Lets you report a claim for them and follow it. Ask for this once a policy is issued." state={consentState("proxy_claims")} disabled={!dataConsent} />
        </div>
      </section>

      <section aria-labelledby="cover-h" className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="cover-h" className="text-lg font-semibold text-ink">Cover for {first}</h2>
          {dataConsent && (
            <Link href={`/account/requests/new?beneficiary=${b.id}`} className={buttonClass("primary", "sm")}>
              <Shield aria-hidden className="size-4" /> Get a quote for {first}
            </Link>
          )}
        </div>
        {(policies ?? []).length ? (
          <ul className="space-y-3">
            {(policies ?? []).map((p) => {
              const s = sponsorshipByPolicy.get(p.id);
              const cat = p.category as unknown as { name: string } | null;
              return (
                <Card as="li" key={p.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <Link href={`/account/policies/${p.id}`} className="block font-medium text-ink hover:text-brand hover:underline">{p.nickname || p.summary || cat?.name || "Policy"}</Link>
                      <span className="block text-xs text-muted">{[p.policy_number ?? p.internal_reference, p.cover_end ? `ends ${formatDate(p.cover_end)}` : null, p.premium ? `${formatGHS(Number(p.premium))} / ${p.billing_period === "month" ? "mo" : "yr"}` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    {s?.gift && <Pill tone={s.gift_revealed_at ? "ok" : "info"}><Gift aria-hidden className="mr-1 inline size-3" />{s.gift_revealed_at ? `Opened ${formatDate(s.gift_revealed_at)}` : "Gift"}</Pill>}
                    <StatusPill meta={POLICY_STATUS[p.status]} />
                    {p.status === "active" && s && (
                      <Link href={`/account/family/claims/new?policy=${p.id}`} className={buttonClass(proxyConsent ? "secondary" : "ghost", "sm")} aria-disabled={!proxyConsent}>
                        <Camera aria-hidden className="size-4" /> File a claim for {first}
                      </Link>
                    )}
                  </div>
                  {s ? (
                    <SponsorshipForm sponsorship={{ id: s.id, gift: s.gift, gift_message: s.gift_message, gift_revealed_at: s.gift_revealed_at, notify_beneficiary: s.notify_beneficiary, policy_id: s.policy_id }} beneficiaryName={first} />
                  ) : (
                    <p className="mt-3 text-xs text-muted">This policy names {first} but has no sponsorship record yet.</p>
                  )}
                </Card>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            {dataConsent ? `No cover yet. Request a quote for ${first} — health, funeral, home, motor or travel.` : `Once ${first} consents you can request quotes for them.`}
          </p>
        )}
        {(sponsorships ?? []).filter((s) => !s.policy_id).map((s) => (
          <p key={s.id} className="mt-3 text-sm text-muted">
            A request is in progress{s.request_id ? <> — <Link href={`/account/requests/${s.request_id}`} className="font-medium text-brand hover:underline">track it</Link></> : null}. The policy appears here when the insurer issues it.
          </p>
        ))}
        {dataConsent && (ownPolicies ?? []).length > 0 && (
          <LinkPolicyForm
            beneficiaryId={b.id}
            beneficiaryName={first}
            policies={(ownPolicies ?? []).map((p) => ({ id: p.id, label: `${p.nickname || p.summary || (p.category as unknown as { name: string } | null)?.name || "Policy"} · ${p.policy_number ?? p.internal_reference}` }))}
          />
        )}
      </section>

      <section aria-labelledby="details-h" className="mb-8">
        <h2 id="details-h" className="mb-3 text-lg font-semibold text-ink">Details</h2>
        <DefinitionList
          items={[
            { label: "Phone", value: b.phone },
            { label: "Email", value: b.email ?? "—" },
            { label: "Date of birth", value: b.date_of_birth ? formatDate(b.date_of_birth) : "—" },
            { label: "Ghana Card", value: b.ghana_card_masked ?? "—" },
            { label: "Region", value: b.region ?? "—" },
            { label: "Consent given", value: b.consent_granted_at ? formatDateTime(b.consent_granted_at) : "—" },
          ]}
        />
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-brand">Edit details</summary>
          <div className="mt-4">
            <Notice tone="wait" className="mb-4">Changing the phone number resets their consent — a new code will be needed.</Notice>
            <BeneficiaryForm
              mode="edit"
              values={{ id: b.id, full_name: b.full_name, relationship: b.relationship, phone: b.phone, email: b.email ?? "", date_of_birth: b.date_of_birth ?? "", ghana_card: "", address: b.address ?? "", region: b.region ?? "", notes: b.notes ?? "" }}
            />
          </div>
        </details>
      </section>
    </>
  );
}
