import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, Notice, PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { LOYALTY_DISCOUNT_NOTE, LOYALTY_RULE_LABEL, formatDate, formatDateTime, formatGHS, loyaltyFormValues, normaliseLoyaltyRuleSet, type LoyaltyRuleType } from "@im/core";
import { can, getPartnerContext, ROLES, type PartnerContext } from "../../_lib/context";
import { LoyaltyRulesForm } from "@/components/partner/loyalty-rules-form";
import { Empty, PageSkeleton, Section } from "@/components/partner/ui";
import { effectiveRuleSet } from "@/server/loyalty";
import { publishRewardRules } from "./actions";

export const metadata: Metadata = { title: "Rewards & discounts" };

export default function RewardsPage() {
  return (
    <>
      <PageHeader title="Rewards & discounts" description="No-claims, loyalty, bundle, early-renewal, safe-driver and referral-credit discounts. Every discount is an explicit line on the quote with the reason — the premium itself is never changed." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Rewards />
      </Suspense>
    </>
  );
}

async function Rewards() {
  const ctx = await getPartnerContext();
  if (ctx.kind === "distributor") return <Notice tone="info">Reward rules belong to insurers. Distributors see nothing here.</Notice>;
  return ctx.kind === "insurer" ? <InsurerRules ctx={ctx} /> : <BrokerView ctx={ctx} />;
}

/** Insurer: the rule set in force (own or platform fallback), the structured editor and the version history. */
async function InsurerRules({ ctx }: { ctx: PartnerContext }) {
  const canEdit = can(ctx, ROLES.orgAdmin);
  const [effective, { data: versions }, { data: recent }] = await Promise.all([
    effectiveRuleSet(ctx.supabase, ctx.orgId),
    ctx.supabase.from("loyalty_rule_sets").select("id, version, status, max_combined_pct, rules, effective_from, effective_to, note, published_at, superseded_at, created_by").eq("insurer_org_id", ctx.orgId).order("version", { ascending: false }).limit(20),
    ctx.supabase.from("quote_discounts").select("id, quote_id, request_id, rule_type, label, amount, created_at").eq("insurer_org_id", ctx.orgId).order("created_at", { ascending: false }).limit(20),
  ]);
  const own = effective && effective.insurerOrgId === ctx.orgId ? effective : null;
  const values = loyaltyFormValues(own ?? effective);
  const activeTypes = (set: ReturnType<typeof normaliseLoyaltyRuleSet>) => set.rules.filter((r) => r.active).map((r) => LOYALTY_RULE_LABEL[r.type]);
  return (
    <div className="space-y-6">
      {effective ? (
        own ? (
          <Notice tone="ok">Your rules version {own.version} is in force{own.effectiveTo ? ` until ${formatDate(own.effectiveTo)}` : ""}. Active: {activeTypes(own).join(", ") || "none"}. Maximum combined discount {own.maxCombinedPct}%.</Notice>
        ) : (
          <Notice tone="info">You have not published rules yet, so the platform fallback (version {effective.version}) applies: {activeTypes(effective).length ? `active — ${activeTypes(effective).join(", ")}` : "every rule switched off, so no discounts are given"}. Publish your own below to take control.</Notice>
        )
      ) : (
        <Notice tone="wait">No rule set is in force. Publish one below.</Notice>
      )}
      {!canEdit && <Notice tone="info">Only owners and admins can publish rules. You can see what is in force.</Notice>}

      <Section title={own ? "Publish a new version" : "Publish your first version"} description="Changes never edit a published version: each publish creates the next one and the previous stays in the history. Rule changes need your own sign-off on the commercial terms; Covva never funds a discount.">
        <LoyaltyRulesForm action={publishRewardRules} values={values} readOnly={!canEdit} />
      </Section>

      <Section title="Version history" description="Every version with who published it and when; superseded versions still explain the discounts given while they were in force.">
        {(versions ?? []).length === 0 ? <Empty>No versions yet.</Empty> : (
          <Table>
            <THead><tr><Th>Version</Th><Th>Status</Th><Th>Active rules</Th><Th>Max combined</Th><Th>In effect</Th><Th>Published</Th><Th>Note</Th></tr></THead>
            <tbody>
              {(versions ?? []).map((s) => {
                const set = normaliseLoyaltyRuleSet(s);
                return (
                  <tr key={s.id}>
                    <Td className="font-medium text-ink">v{s.version}</Td>
                    <Td><Pill tone={s.status === "published" ? "ok" : "neutral"}>{s.status}</Pill></Td>
                    <Td className="text-xs">{activeTypes(set).join(", ") || "none"}</Td>
                    <Td className="tabular-nums">{Number(s.max_combined_pct)}%</Td>
                    <Td className="text-xs">{formatDate(s.effective_from)}{s.effective_to ? ` – ${formatDate(s.effective_to)}` : ""}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(s.published_at)}{s.superseded_at ? ` · superseded ${formatDate(s.superseded_at)}` : ""}</Td>
                    <Td className="max-w-xs text-xs text-muted">{s.note ?? "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Recent discount lines on your quotes" description="What the engine applied, line by line — the same lines the customer and broker see.">
        {(recent ?? []).length === 0 ? <Empty>No discounts applied yet.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {(recent ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-medium text-ink">{LOYALTY_RULE_LABEL[d.rule_type as LoyaltyRuleType] ?? d.label}</span> <span className="text-muted">· {formatDateTime(d.created_at)}</span>{d.request_id && <Link href={`/partner/submissions`} className="ml-2 text-brand hover:underline">Submissions</Link>}</span>
                <span className="tabular-nums font-medium text-ink">−{formatGHS(Number(d.amount), { decimals: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-xs text-muted">{LOYALTY_DISCOUNT_NOTE} Safe-driver discounts use the customer&apos;s consented monthly driving score only; you never see trips.</p>
      {ctx.isDemo && <DemoBadge />}
    </div>
  );
}

/** Broker: discounts are the insurer's; brokers see the lines on their own quotes. */
async function BrokerView({ ctx }: { ctx: PartnerContext }) {
  const { data: recent } = await ctx.supabase
    .from("quote_discounts")
    .select("id, quote_id, request_id, insurer_org_id, rule_type, label, explanation, amount, created_at, insurer:organizations!quote_discounts_insurer_org_id_fkey(name)")
    .eq("broker_org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (
    <div className="space-y-6">
      <Notice tone="info">Insurers set and fund their own reward rules. When one applies to a quote you prepared, the discount appears as an explicit line under the premium on the request page and on the customer&apos;s comparison — the premium you entered is never changed.</Notice>
      <Section title="Discount lines on your quotes" description="Latest 50.">
        {(recent ?? []).length === 0 ? <Empty>No insurer discounts have applied to your quotes yet.</Empty> : (
          <Table>
            <THead><tr><Th>When</Th><Th>Insurer</Th><Th>Discount</Th><Th>Why</Th><Th className="text-right">Amount</Th><Th /></tr></THead>
            <tbody>
              {(recent ?? []).map((d) => (
                <tr key={d.id}>
                  <Td className="text-xs">{formatDateTime(d.created_at)}</Td>
                  <Td>{(d.insurer as unknown as { name?: string } | null)?.name ?? "Insurer"}</Td>
                  <Td className="font-medium text-ink">{LOYALTY_RULE_LABEL[d.rule_type as LoyaltyRuleType] ?? d.label}</Td>
                  <Td className="max-w-md text-xs text-muted">{d.explanation}</Td>
                  <Td className="text-right tabular-nums">−{formatGHS(Number(d.amount), { decimals: true })}</Td>
                  <Td>{d.request_id && <Link href={`/partner/requests/${d.request_id}`} className="text-xs font-medium text-brand hover:underline">Request</Link>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <p className="text-xs text-muted">{LOYALTY_DISCOUNT_NOTE}</p>
    </div>
  );
}
