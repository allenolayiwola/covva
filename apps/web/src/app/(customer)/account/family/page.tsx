import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, Camera, Gift, HeartHandshake, Plus, RefreshCw, Shield, UserPlus, Wallet } from "lucide-react";
import { CLAIM_STATUS, CONSENT_STATUS, POLICY_STATUS, formatDate, formatGHS, humanize, relationshipLabel } from "@im/core";
import { Card, EmptyState, Notice, PageHeader, Pill, StatCard, StatusPill, buttonClass } from "@im/ui";
import { getProfile } from "@/lib/auth";
import { PageSkeleton } from "@/components/customer/skeletons";
import { familyDashboard } from "@/server/diaspora";
import { account } from "../_lib/data";

export const metadata: Metadata = { title: "Family" };

export default function FamilyPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Family"
        description="Cover you pay for family in Ghana: who is covered, what renews when, what you pay and any claims — with your relatives kept in the loop."
        actions={
          <Link href="/account/family/beneficiaries/new" className={buttonClass("primary", "sm")}>
            <UserPlus aria-hidden className="size-4" /> Add a family member
          </Link>
        }
      />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const { user, supabase } = await account("/account/family");
  const [dash, profile] = await Promise.all([familyDashboard(supabase, user.id), getProfile()]);
  const { summary, beneficiaries, policies, claims, payments, subscriptions, sponsorships } = dash;
  const byBeneficiary = new Map(beneficiaries.map((b) => [b.id, b]));
  const sponsorshipByPolicy = new Map(sponsorships.filter((s) => s.policy_id).map((s) => [s.policy_id!, s]));
  const pendingConsent = beneficiaries.filter((b) => b.consent_status !== "granted");
  const abroad = (profile?.country_code ?? "GH") !== "GH";

  if (!beneficiaries.length && !policies.length) {
    return (
      <EmptyState
        icon={<HeartHandshake className="size-5" />}
        title="Look after family in Ghana from anywhere"
        body={
          <>
            Add a parent, sibling, child or spouse as a beneficiary. They confirm by SMS or WhatsApp code, then you can request cover for them, pay
            {abroad ? ` in ${profile?.preferred_currency ?? "your currency"}` : ""} and follow renewals and claims here. Both of you get the documents and reminders.
          </>
        }
        action={
          <Link href="/account/family/beneficiaries/new" className={buttonClass("primary")}>
            <UserPlus aria-hidden className="size-4" /> Add a family member
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Family members" value={beneficiaries.length} hint={pendingConsent.length ? `${pendingConsent.length} awaiting consent` : "All consented"} tone={pendingConsent.length ? "warn" : "default"} />
        <StatCard label="Active policies" value={summary.activePolicies} hint={summary.pendingPolicies ? `${summary.pendingPolicies} awaiting issuance` : undefined} />
        <StatCard
          label="Next renewal"
          value={summary.nextRenewal ? `${summary.nextRenewal.days} day${summary.nextRenewal.days === 1 ? "" : "s"}` : "—"}
          hint={summary.nextRenewal ? formatDate(summary.nextRenewal.coverEnd) : "No renewals due"}
          tone={summary.nextRenewal && summary.nextRenewal.days <= 14 ? "warn" : "default"}
        />
        <StatCard label="Premiums per year" value={formatGHS(summary.annualPremiumGHS)} hint={summary.openClaims ? `${summary.openClaims} open claim${summary.openClaims === 1 ? "" : "s"}` : "No open claims"} />
      </div>

      {summary.coverGaps.length > 0 && (
        <Notice tone="wait" title="Next steps">
          <ul className="list-disc space-y-1 pl-5">
            {summary.coverGaps.map((g) => (
              <li key={g.beneficiaryId}>
                {g.reason === "consent_pending" && (
                  <>
                    <Link href={`/account/family/beneficiaries/${g.beneficiaryId}`} className="font-medium text-brand hover:underline">{g.name}</Link> hasn&apos;t consented yet — send them a code.
                  </>
                )}
                {g.reason === "consent_declined" && (
                  <>
                    <Link href={`/account/family/beneficiaries/${g.beneficiaryId}`} className="font-medium text-brand hover:underline">{g.name}</Link> declined. Talk to them, then ask again.
                  </>
                )}
                {g.reason === "no_cover" && (
                  <>
                    <Link href={`/account/requests/new?beneficiary=${g.beneficiaryId}`} className="font-medium text-brand hover:underline">Get a quote for {g.name}</Link> — they have no live cover yet.
                  </>
                )}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <section aria-labelledby="members">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="members" className="text-lg font-semibold text-ink">Family members</h2>
          <Link href="/account/family/beneficiaries/new" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            <Plus aria-hidden className="size-4" /> Add
          </Link>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {beneficiaries.map((b) => {
            const meta = CONSENT_STATUS[b.consent_status as keyof typeof CONSENT_STATUS] ?? CONSENT_STATUS.pending;
            const theirs = policies.filter((p) => p.beneficiary_id === b.id);
            return (
              <Card as="li" key={b.id} className="p-4">
                <Link href={`/account/family/beneficiaries/${b.id}`} className="flex items-start justify-between gap-3 hover:text-brand">
                  <span>
                    <span className="block font-semibold text-ink">{b.full_name}</span>
                    <span className="block text-sm text-muted">{relationshipLabel(b.relationship)} · {b.phone}{b.has_account ? " · has a Covva account" : ""}</span>
                  </span>
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                </Link>
                <p className="mt-2 text-sm text-muted">
                  {theirs.length ? `${theirs.length} polic${theirs.length === 1 ? "y" : "ies"}: ${theirs.map((p) => p.category?.name ?? "Policy").join(", ")}` : "No cover yet."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {b.consent_status === "granted" ? (
                    <Link href={`/account/requests/new?beneficiary=${b.id}`} className={buttonClass("secondary", "sm")}>Get a quote for {b.full_name.split(" ")[0]}</Link>
                  ) : (
                    <Link href={`/account/family/beneficiaries/${b.id}`} className={buttonClass("primary", "sm")}>Send consent code</Link>
                  )}
                </div>
              </Card>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="policies">
        <h2 id="policies" className="mb-3 text-lg font-semibold text-ink">Policies you pay for</h2>
        {policies.length ? (
          <ul className="divide-y divide-line rounded-card border border-line">
            {policies.map((p) => {
              const b = p.beneficiary_id ? byBeneficiary.get(p.beneficiary_id) : null;
              const s = sponsorshipByPolicy.get(p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <Shield aria-hidden className="size-4 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <Link href={`/account/policies/${p.id}`} className="block font-medium text-ink hover:text-brand hover:underline">
                      {p.nickname || p.summary || p.category?.name || "Policy"}{b ? ` · for ${b.full_name}` : ""}
                    </Link>
                    <span className="block text-xs text-muted">
                      {[p.insurer?.name, p.policy_number ?? p.internal_reference, p.cover_end ? `ends ${formatDate(p.cover_end)}` : null, p.premium ? `${formatGHS(Number(p.premium))} / ${p.billing_period === "month" ? "mo" : "yr"}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {s?.gift && <Pill tone={s.gift_revealed_at ? "ok" : "info"}><Gift aria-hidden className="mr-1 inline size-3" />{s.gift_revealed_at ? "Gift opened" : "Gift"}</Pill>}
                  <StatusPill meta={POLICY_STATUS[p.status]} />
                  {p.status === "active" && s && b && (
                    <Link href={`/account/family/claims/new?policy=${p.id}`} className={buttonClass("ghost", "sm")}>
                      <Camera aria-hidden className="size-4" /> File a claim for {b.full_name.split(" ")[0]}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No policies yet. Once a family member has consented, request a quote for them and pay — the policy shows here with its renewal date.</p>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="schedule">
          <h2 id="schedule" className="mb-3 text-lg font-semibold text-ink">Payment schedule</h2>
          {subscriptions.length || payments.length ? (
            <ul className="divide-y divide-line rounded-card border border-line text-sm">
              {subscriptions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <CalendarClock aria-hidden className="size-4 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{s.display_currency} {Number(s.display_amount).toFixed(2)} every {s.cadence}</span>
                    <span className="block text-xs text-muted">Next charge {formatDate(s.next_charge_at)} · {formatGHS(Number(s.ghs_amount))} to the insurer</span>
                  </span>
                  <Pill tone={s.status === "active" ? "ok" : s.status === "past_due" ? "danger" : "neutral"}>{humanize(s.status)}</Pill>
                </li>
              ))}
              {payments.slice(0, 8).map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Wallet aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{p.currency} {Number(p.amount).toFixed(2)}</span>
                    <span className="block text-xs text-muted">{p.paid_at ? `Paid ${formatDate(p.paid_at)}` : `Created ${formatDate(p.created_at)}`}{p.channel ? ` · ${humanize(p.channel)}` : ""}</span>
                  </span>
                  <Pill tone={p.status === "succeeded" ? "ok" : p.status === "failed" ? "danger" : "neutral"}>{humanize(p.status)}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing due. Premiums you pay and any monthly plan show here.</p>
          )}
          {summary.nextPaymentDue && (
            <p className="mt-2 text-xs text-muted">
              <RefreshCw aria-hidden className="mr-1 inline size-3" /> Next payment due {formatDate(summary.nextPaymentDue.dueAt)}.
            </p>
          )}
        </section>

        <section aria-labelledby="claims">
          <h2 id="claims" className="mb-3 text-lg font-semibold text-ink">Claims</h2>
          {claims.length ? (
            <ul className="divide-y divide-line rounded-card border border-line text-sm">
              {claims.map((c) => (
                <li key={c.id}>
                  <Link href={`/account/claims/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-mist/50">
                    <span>
                      <span className="font-medium text-ink">{humanize(c.incident_type)}</span>
                      <span className="text-muted"> · {c.reference} · {formatDate(c.created_at)}{c.reported_by_user_id === user.id ? " · reported by you" : ""}</span>
                    </span>
                    <StatusPill meta={CLAIM_STATUS[c.status]} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No claims on the policies you pay for. With your relative&apos;s consent you can report one for them.</p>
          )}
        </section>
      </div>

      <p className="text-xs text-subtle">
        Policies are arranged by a licensed broker and issued by a licensed insurer; Covva is the platform. Your relative&apos;s consent is captured from their own phone and can be withdrawn by contacting support.
      </p>
    </>
  );
}
