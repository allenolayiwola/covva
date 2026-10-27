import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ENDORSEMENT_KINDS, ENDORSEMENT_STATUS, adjustmentLabel, formatDate, formatDateTime, type EndorsementKind, type EndorsementStatus } from "@im/core";
import { Field, Input, Notice, PageHeader, Pill, Select, Textarea } from "@im/ui";
import { ROLES, can, getPartnerContext } from "../../_lib/context";
import { getCustomers, shortName } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { Chip, Empty, KV, PageSkeleton, Section } from "@/components/partner/ui";
import { applyChange, decideChange, quoteChange } from "./actions";

export const metadata: Metadata = { title: "Policy changes" };

/**
 * Endorsement queue for brokers and insurers. Brokers of record review and quote; only the insurer
 * accepts, rejects and applies a change to cover (enforced by the endorsements_guard trigger).
 */
export default function EndorsementsPage({ searchParams }: PageProps<"/partner/endorsements">) {
  return (
    <>
      <PageHeader title="Policy changes" description="Endorsements requested by customers: review, quote the change in premium, and (insurers) accept and apply them to the policy." />
      <Suspense fallback={<PageSkeleton />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const FILTERS = [
  { key: "open", label: "Open", statuses: ["submitted", "quoted", "accepted"] },
  { key: "quoted", label: "Waiting on customer", statuses: ["quoted"] },
  { key: "accepted", label: "To apply", statuses: ["accepted"] },
  { key: "done", label: "Closed", statuses: ["applied", "rejected", "cancelled"] },
] as const;

type Line = { label: string; before: string; after: string };

async function Queue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPartnerContext();
  const sp = await searchParams;
  const filterKey = typeof sp.status === "string" ? sp.status : "open";
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const focus = typeof sp.id === "string" ? sp.id : null;
  const isInsurer = ctx.kind === "insurer";
  const canQuote = can(ctx, isInsurer ? ROLES.underwrite : ROLES.brokerWork);
  const canDecide = isInsurer && can(ctx, ROLES.underwrite);

  const { data } = await ctx.supabase
    .from("endorsements")
    .select("*, policy:policies(id, policy_number, internal_reference, premium, sum_insured, cover_end, currency)")
    .or(`insurer_org_id.eq.${ctx.orgId},broker_org_id.eq.${ctx.orgId}`)
    .in("status", [...filter.statuses])
    .order("updated_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as (NonNullable<typeof data>[number] & { policy: { id: string; policy_number: string | null; internal_reference: string; premium: number | null; sum_insured: number | null; cover_end: string | null; currency: string } | null })[];
  const customers = await getCustomers(ctx, rows.map((r) => r.customer_id));
  if (focus && !rows.some((r) => r.id === focus)) {
    const { data: one } = await ctx.supabase.from("endorsements").select("*, policy:policies(id, policy_number, internal_reference, premium, sum_insured, cover_end, currency)").eq("id", focus).maybeSingle();
    if (one) rows.unshift(one as unknown as (typeof rows)[number]);
  }

  return (
    <div className="space-y-5">
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => <Chip key={f.key} href={`/partner/endorsements?status=${f.key}`} active={f.key === filter.key}>{f.label}</Chip>)}
      </nav>
      <Notice tone="info">Only the insurer changes cover. {isInsurer ? "Accept a change once the customer has agreed to any premium adjustment; apply it once any additional premium is paid." : "Quote the change in premium; the insurer accepts and applies it."} Additional premium is paid by the customer to the insurer.</Notice>
      {!rows.length && <Empty>No policy changes here.</Empty>}
      {rows.map((e) => {
        const status = e.status as EndorsementStatus;
        const meta = ENDORSEMENT_STATUS[status] ?? { label: e.status, tone: "neutral" as const };
        const lines = (((e.changes ?? {}) as { lines?: Line[] }).lines ?? []) as Line[];
        const uw = (e.underwriting ?? null) as { outcome?: string; reasons?: string[] } | null;
        const amount = e.premium_adjustment == null ? null : Number(e.premium_adjustment);
        const party = e.insurer_org_id === ctx.orgId ? "insurer" : "broker";
        return (
          <Section
            key={e.id}
            id={`e-${e.id}`}
            tone={focus === e.id ? "mist" : "white"}
            title={<span>{ENDORSEMENT_KINDS[e.kind as EndorsementKind]?.label ?? e.kind} · {e.reference}</span>}
            description={<>Policy {e.policy?.policy_number ?? e.policy?.internal_reference} · {shortName(customers.get(e.customer_id))} · effective {formatDate(e.effective_from)}</>}
            actions={<Pill tone={meta.tone}>{meta.label}</Pill>}
          >
            <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
              <div className="space-y-3 text-sm">
                {lines.length ? (
                  <ul className="space-y-1">
                    {lines.map((l) => <li key={l.label}><span className="text-muted">{l.label}:</span> {l.before} → <span className="font-medium text-ink">{l.after}</span></li>)}
                  </ul>
                ) : <p className="text-muted">No structured details.</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  <KV label="Quoted adjustment">{adjustmentLabel(amount, e.currency)}</KV>
                  <KV label="Rating engine (indicative)">{e.proposed_adjustment == null ? "—" : adjustmentLabel(e.proposed_adjustment, e.currency)}</KV>
                  <KV label="Customer agreed">{e.customer_accepted_at ? formatDateTime(e.customer_accepted_at) : "Not yet"}</KV>
                  <KV label="Current premium">{e.policy?.premium != null ? `${e.currency} ${Number(e.policy.premium).toFixed(2)}` : "—"}</KV>
                </div>
                {uw?.outcome && uw.outcome !== "accept" && <Notice tone={uw.outcome === "decline" ? "danger" : "wait"} title={`Underwriting rules: ${uw.outcome}`}>{(uw.reasons ?? []).join(" ") || "A rule matched the changed risk."}</Notice>}
                {e.broker_note && <p><span className="text-muted">Broker note:</span> {e.broker_note}</p>}
                {e.insurer_note && <p><span className="text-muted">Insurer note:</span> {e.insurer_note}</p>}
                {e.request_id && <Link href={`/partner/requests/${e.request_id}`} className="text-sm font-semibold text-brand hover:underline">Open the request</Link>}
              </div>
              <div className="space-y-3">
                {canQuote && ["submitted", "quoted"].includes(status) && (
                  <ActionForm action={quoteChange} submitLabel={status === "quoted" ? "Re-quote" : "Send quote to customer"} className="space-y-2">
                    <input type="hidden" name="endorsementId" value={e.id} />
                    <Field label={`Premium adjustment (${e.currency})`} htmlFor={`q-${e.id}`} hint="Positive = additional premium, negative = refund, 0 = no change">
                      <Input id={`q-${e.id}`} name="premiumAdjustment" type="number" step="0.01" required defaultValue={amount ?? e.proposed_adjustment ?? ""} className="h-10 text-sm" />
                    </Field>
                    <Field label="Note to the customer (optional)" htmlFor={`qn-${e.id}`}>
                      <Textarea id={`qn-${e.id}`} name="note" rows={2} className="min-h-14 text-sm" />
                    </Field>
                  </ActionForm>
                )}
                {canDecide && party === "insurer" && ["submitted", "quoted"].includes(status) && (
                  <ActionForm action={decideChange} submitLabel="Record decision" className="space-y-2">
                    <input type="hidden" name="endorsementId" value={e.id} />
                    <Field label="Decision" htmlFor={`d-${e.id}`}>
                      <Select id={`d-${e.id}`} name="decision" defaultValue="accept" className="h-10 text-sm">
                        <option value="accept">Accept the change</option>
                        <option value="reject">Reject the change</option>
                      </Select>
                    </Field>
                    <Field label="Note (optional)" htmlFor={`dn-${e.id}`}>
                      <Textarea id={`dn-${e.id}`} name="note" rows={2} className="min-h-14 text-sm" />
                    </Field>
                  </ActionForm>
                )}
                {canDecide && party === "insurer" && status === "accepted" && (
                  <ActionForm action={applyChange} submitLabel="Apply to policy and reissue documents" confirm="Apply this change to the policy? The schedule and certificate are regenerated." className="space-y-2">
                    <input type="hidden" name="endorsementId" value={e.id} />
                    <Field label="Endorsement note (optional)" htmlFor={`an-${e.id}`}>
                      <Textarea id={`an-${e.id}`} name="note" rows={2} className="min-h-14 text-sm" />
                    </Field>
                  </ActionForm>
                )}
                {!canQuote && !canDecide && <p className="text-sm text-muted">Your role can view changes only.</p>}
              </div>
            </div>
          </Section>
        );
      })}
    </div>
  );
}
