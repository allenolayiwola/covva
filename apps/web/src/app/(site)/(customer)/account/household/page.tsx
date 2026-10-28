import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HeartHandshake, Plus, Shield, UserPlus, Users } from "lucide-react";
import { POLICY_STATUS, formatDate, formatGHS, relationshipLabel, type HouseholdPerson } from "@im/core";
import { Card, EmptyState, Notice, PageHeader, Pill, StatCard, StatusPill, buttonClass } from "@im/ui";
import { getProfile } from "@/lib/auth";
import { FamilyTabs } from "@/components/customer/family-tabs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { householdCover } from "@/server/household";
import { account } from "../_lib/data";

export const metadata: Metadata = { title: "Household cover" };

/**
 * Household view (Roadmap Phase 1): everyone's cover in one place — yours, the family members you pay
 * for, and what a relative pays for you. Works for a customer in Ghana as much as for a sponsor abroad.
 */
export default function HouseholdPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Household cover"
        description="Everyone in your household and the cover each person has: your own policies, the ones you pay for family, and the ones a relative pays for you."
        actions={
          <Link href="/account/family/beneficiaries/new" className={buttonClass("secondary", "sm")}>
            <UserPlus aria-hidden className="size-4" /> Add a family member
          </Link>
        }
      />
      <FamilyTabs active="household" />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body />
      </Suspense>
    </div>
  );
}

const COVER_PILL: Record<HouseholdPerson["coverState"], { label: string; tone: "ok" | "wait" | "danger" | "neutral" | "info" }> = {
  covered: { label: "Covered", tone: "ok" },
  expiring: { label: "Ends soon", tone: "wait" },
  pending: { label: "Being issued", tone: "info" },
  lapsed: { label: "Cover ended", tone: "danger" },
  none: { label: "No cover", tone: "neutral" },
};

async function Body() {
  const { user, supabase } = await account("/account/household");
  const profile = await getProfile();
  const view = await householdCover(supabase, user.id, profile?.preferred_name || profile?.full_name || null);
  const { people, summary } = view;
  const anyPolicies = people.some((p) => p.policies.length > 0);

  if (!anyPolicies && people.length <= 1) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="Nobody in your household has cover yet"
        body="Get a quote for yourself, or add a parent, child, sibling or spouse and arrange cover for them. If a relative abroad pays for your cover, it shows here once they add you and you consent."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/account/requests/new" className={buttonClass("primary")}><Plus aria-hidden className="size-4" /> Get a quote</Link>
            <Link href="/account/family/beneficiaries/new" className={buttonClass("secondary")}><UserPlus aria-hidden className="size-4" /> Add a family member</Link>
          </div>
        }
      />
    );
  }

  const gaps = people.filter((p) => p.nextStep && p.role !== "other");

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="People" value={summary.people} hint={summary.withoutCover ? `${summary.withoutCover} without cover` : "Everyone has cover"} tone={summary.withoutCover ? "warn" : "default"} />
        <StatCard label="Live policies" value={summary.activePolicies} hint={summary.pendingPolicies ? `${summary.pendingPolicies} being issued` : summary.expiringSoon ? `${summary.expiringSoon} end${summary.expiringSoon === 1 ? "s" : ""} within 30 days` : undefined} tone={summary.expiringSoon ? "warn" : "default"} />
        <StatCard
          label="Next renewal"
          value={summary.nextRenewal ? `${summary.nextRenewal.days} day${summary.nextRenewal.days === 1 ? "" : "s"}` : "—"}
          hint={summary.nextRenewal ? `${summary.nextRenewal.personName === "You" ? "You" : summary.nextRenewal.personName.split(" ")[0]} · ${formatDate(summary.nextRenewal.coverEnd)}` : "No renewals due"}
          tone={summary.nextRenewal && summary.nextRenewal.days <= 14 ? "warn" : "default"}
        />
        <StatCard label="Premiums per year" value={formatGHS(summary.annualPremiumGHS)} hint={summary.sponsoredForYou ? `${summary.sponsoredForYou} polic${summary.sponsoredForYou === 1 ? "y" : "ies"} paid for you by family` : "Across the household"} />
      </div>

      {gaps.length > 0 && (
        <Notice tone="wait" title="Next steps">
          <ul className="list-disc space-y-1 pl-5">
            {gaps.map((p) => (
              <li key={p.key}>
                {p.nextStep}{" "}
                {p.role === "member" && p.consentStatus !== "granted" ? (
                  <Link href={`/account/family/beneficiaries/${p.beneficiaryId}`} className="font-medium text-brand hover:underline">Open {p.name.split(" ")[0]}</Link>
                ) : (
                  <Link href={p.beneficiaryId ? `/account/requests/new?beneficiary=${p.beneficiaryId}` : "/account/requests/new"} className="font-medium text-brand hover:underline">Get a quote</Link>
                )}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <section aria-labelledby="people" className="space-y-4">
        <h2 id="people" className="text-lg font-semibold text-ink">Who is covered</h2>
        {people.map((p) => {
          const pill = COVER_PILL[p.coverState];
          const first = p.role === "you" ? "you" : p.name.split(" ")[0];
          return (
            <Card as="section" key={p.key} className="p-4 sm:p-5" aria-label={p.name}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-2 text-brand-deep" aria-hidden>
                    {p.role === "you" ? <Shield className="size-5" /> : p.role === "member" ? <HeartHandshake className="size-5" /> : <Users className="size-5" />}
                  </span>
                  <div>
                    <h3 className="font-semibold text-ink">
                      {p.role === "you" ? `${p.name === "You" ? "You" : `${p.name} (you)`}` : p.name}
                    </h3>
                    <p className="text-sm text-muted">
                      {p.role === "member" ? `${relationshipLabel(p.relationship)}${p.consentStatus !== "granted" ? ` · consent ${p.consentStatus ?? "pending"}` : ""}` : p.role === "you" ? "Your own cover and what family pays for you" : "Policies you pay for that cover someone not listed as a family member"}
                    </p>
                  </div>
                </div>
                <Pill tone={pill.tone}>{pill.label}</Pill>
              </div>

              {p.policies.length ? (
                <ul className="mt-4 divide-y divide-line rounded-card border border-line">
                  {p.policies.map((pol) => (
                    <li key={pol.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className="min-w-0 flex-1">
                        <Link href={`/account/policies/${pol.id}`} className="block font-medium text-ink hover:text-brand hover:underline">{pol.title}</Link>
                        <span className="block text-xs text-muted">
                          {[pol.insurerName, pol.policyNumber, pol.coverEnd ? `ends ${formatDate(pol.coverEnd)}` : null, pol.premium !== null && pol.currency ? `${pol.currency === "GHS" ? formatGHS(pol.premium) : `${pol.currency} ${pol.premium.toFixed(2)}`}${pol.billingPeriod === "month" ? " / mo" : pol.billingPeriod === "year" ? " / yr" : pol.billingPeriod ? ` / ${pol.billingPeriod}` : ""}` : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <Pill tone={pol.payer === "you" ? "neutral" : "info"}>{pol.payerLabel}</Pill>
                      <StatusPill meta={POLICY_STATUS[pol.status as keyof typeof POLICY_STATUS] ?? { label: pol.status, tone: "neutral" }} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted">No policies for {first} yet.</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {p.role === "member" && p.consentStatus !== "granted" && p.beneficiaryId && (
                  <Link href={`/account/family/beneficiaries/${p.beneficiaryId}`} className={buttonClass("primary", "sm")}>Send consent code</Link>
                )}
                {(p.role === "you" || (p.role === "member" && p.consentStatus === "granted")) && (
                  <Link href={p.beneficiaryId ? `/account/requests/new?beneficiary=${p.beneficiaryId}` : "/account/requests/new"} className={buttonClass("secondary", "sm")}>
                    <Plus aria-hidden className="size-4" /> Get a quote for {first}
                  </Link>
                )}
                {p.beneficiaryId && <Link href={`/account/family/beneficiaries/${p.beneficiaryId}`} className={buttonClass("ghost", "sm")}>Details</Link>}
              </div>
            </Card>
          );
        })}
      </section>

      <p className="text-xs text-subtle">
        You only see policies you hold, pay for, or that a relative pays for you with your consent. Policies are arranged by a licensed broker and issued by a licensed insurer; Covva is the platform and never holds your premium.
      </p>
    </>
  );
}
