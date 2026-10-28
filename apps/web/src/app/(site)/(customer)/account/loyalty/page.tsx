import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Award, Car, Gift, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { formatDate, formatGHS } from "@im/core";
import { Card, Notice, PageHeader, Pill, StatCard, buttonClass } from "@im/ui";
import { getFlags } from "@/lib/catalog";
import { ListSkeleton } from "@/components/customer/skeletons";
import { loyaltySummaryForUser } from "@/server/loyalty";
import { account, requestTime } from "../_lib/data";

export const metadata: Metadata = { title: "Rewards" };

export default function LoyaltyPage() {
  return (
    <>
      <PageHeader title="Rewards" description="What your history with Covva and your insurers earns you, and what you can expect at renewal. No points, no games: every discount is set and paid for by the insurer, and we show you exactly why." />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Loyalty />
      </Suspense>
    </>
  );
}

async function Loyalty() {
  const { user, supabase } = await account("/account/loyalty");
  const [summary, flags] = await Promise.all([loyaltySummaryForUser(supabase, user.id, new Date(requestTime())), getFlags()]);
  const h = summary.history;
  const mainTier = summary.insurers.find((i) => i.tier)?.tier ?? null;
  const anyRules = summary.insurers.some((i) => i.rulesVersion !== null);

  return (
    <div className="space-y-6" data-testid="loyalty-page">
      {flags.demo_mode && <Pill tone="wait">DEMO · illustrative insurers</Pill>}
      {!h.hasHistory && (
        <Notice tone="info" icon={<ShieldCheck className="size-4" aria-hidden />}>
          {h.externalOnly
            ? "Policies you added yourself can't be verified, so they don't count towards no-claims years yet. Cover arranged through Covva starts your record."
            : "Your record starts with your first policy through Covva. Each claim-free year is remembered for every insurer on the platform."}
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Claim-free years" value={h.claimFreeYears} hint={h.hasHistory ? `${h.yearsOnCovva} year${h.yearsOnCovva === 1 ? "" : "s"} on Covva` : "Starts with your first policy"} />
        <StatCard label="Loyalty tier" value={mainTier ? mainTier.name : anyRules ? "Starter" : "—"} hint={mainTier?.next ? `${mainTier.next.name} after ${mainTier.next.years} years with the insurer` : anyRules ? "Set by your insurer" : "Your insurers have not published tiers yet"} />
        <StatCard label="Referral credit" value={formatGHS(summary.creditBalance, { decimals: true })} hint="Not cash" />
      </div>

      {summary.insurers.length > 0 && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Award aria-hidden className="size-5 text-brand" /> Your insurers</h2>
          <ul className="mt-3 divide-y divide-line">
            {summary.insurers.map((i) => (
              <li key={i.insurerOrgId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{i.insurerName}</p>
                  <p className="text-[13px] text-muted">
                    {i.yearsWithInsurer} year{i.yearsWithInsurer === 1 ? "" : "s"} with this insurer
                    {i.rulesVersion === null ? " · no reward rules published yet" : i.isPlatformFallback ? " · platform rules apply" : ` · insurer rules v${i.rulesVersion}`}
                  </p>
                </div>
                {i.tier ? <Pill tone={i.tier.pct > 0 ? "ok" : "neutral"}>{i.tier.name}{i.tier.pct > 0 ? ` · ${i.tier.pct}% off` : ""}</Pill> : <Pill>No tiers</Pill>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><RefreshCw aria-hidden className="size-5 text-brand" /> Upcoming renewal perks</h2>
        {summary.upcomingRenewals.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No cover ends in the next 120 days. When a renewal comes up we&apos;ll show here exactly what your insurer&apos;s rules would take off and why.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {summary.upcomingRenewals.map((r) => (
              <li key={r.policyId} className="rounded-card border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink">{r.categoryName} · {r.insurerName}</p>
                  <p className="text-[13px] text-muted">Policy {r.policyNumber}{r.coverEnd ? ` · ends ${formatDate(r.coverEnd)}` : ""}{r.daysLeft !== null ? ` · ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}` : ""}</p>
                </div>
                {r.perks.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">This insurer has not switched on any renewal rewards yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {r.perks.map((p) => (
                      <li key={p.ruleKey} className="flex items-start gap-2 text-sm">
                        <Pill tone={p.qualifies ? "ok" : "neutral"} className="mt-0.5 shrink-0">{p.qualifies ? "You qualify" : "Not yet"}</Pill>
                        <span><span className="font-medium text-ink">{p.label}.</span> <span className="text-ink-2">{p.text}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href={`/account/policies/${r.policyId}/renew`} className={buttonClass("secondary", "sm", "mt-3")}>Review renewal</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[13px] text-muted">Renewal prices are estimates until the insurer confirms them. Discounts shown at renewal are listed line by line with the reason.</p>
      </Card>

      {summary.recentSavings.length > 0 && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Sparkles aria-hidden className="size-5 text-brand" /> What you saved in the last year</h2>
          <ul className="mt-3 divide-y divide-line">
            {summary.recentSavings.map((s) => (
              <li key={`${s.quoteId}-${s.label}-${s.createdAt}`} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{s.label}</span>
                  <span className="block text-[13px] text-muted">{s.explanation} {s.requestId && <Link href={`/account/requests/${s.requestId}/quotes/${s.quoteId}`} className="font-medium text-brand hover:underline">View quote</Link>}</span>
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-brand-deep">−{formatGHS(s.amount, { decimals: true })}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Gift aria-hidden className="size-5 text-brand" /> How to earn more</h2>
        {summary.howToEarnMore.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Your insurers have not switched on reward rules yet. Rewards for buying insurance need the insurer&apos;s (and where required the National Insurance Commission&apos;s) approval first. Nothing here changes which quotes you see.</p>
        ) : (
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            {summary.howToEarnMore.map((t) => <li key={t}>{t}</li>)}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/account/referrals" className={buttonClass("secondary", "sm")}><Gift aria-hidden className="size-4" /> Refer a friend</Link>
          <Link href="/account/telematics" className={buttonClass("secondary", "sm")}><Car aria-hidden className="size-4" /> Driving score{summary.telematics.activeEnrolments ? ` · ${summary.telematics.latestScore ?? "—"}` : ""}</Link>
        </div>
      </Card>

      <p className="text-[13px] text-muted">{summary.note}</p>
    </div>
  );
}
