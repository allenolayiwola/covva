import "server-only";
import { computeSplit, feeBreakdownForQuote, type BusinessSource, type FeeBreakdown, type Split, type SplitTerms } from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

/**
 * Commercial terms and checkout splits (Addendum 2 §F). Pure arithmetic lives in
 * `@im/core/splits`; this module reads the organisations' terms and persists the
 * per-payment split. Premiums still settle to the insurer: the broker and platform
 * rows are commission / fee portions, paid by the insurer out of the premium.
 *
 * Paystack settles ONE subaccount per transaction. A true three-way split needs a
 * Paystack **split group** (`split_code`, "SPL_…", created in the Paystack dashboard
 * with the insurer, broker and platform subaccounts). When an org-level
 * `organizations.paystack_split_code` or the `PAYSTACK_SPLIT_GROUP_CODE` env is set,
 * checkout passes `split_code`; otherwise it falls back to the insurer's single
 * subaccount with `bearer: "subaccount"` and the broker / platform shares are settled
 * by the periodic settlement statement (cron `settlement-statements`).
 */
type Svc = ReturnType<typeof createServiceClient>;
export type CommercialTerms = Row<"org_commercial_terms">;

const today = () => new Date().toISOString().slice(0, 10);

/** The terms in force for an organisation on a date (latest row whose period covers it). */
export async function activeTerms(svc: Svc, orgId: string, on = today()): Promise<CommercialTerms | null> {
  const { data } = await svc
    .from("org_commercial_terms")
    .select("*")
    .eq("org_id", orgId)
    .lte("effective_from", on)
    .or(`effective_to.is.null,effective_to.gte.${on}`)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Resolve the split percentages from the insurer's and the broker's terms. */
export async function splitTermsFor(svc: Svc, insurerOrgId: string, brokerOrgId: string | null, on = today()): Promise<SplitTerms> {
  const [insurer, broker] = await Promise.all([activeTerms(svc, insurerOrgId, on), brokerOrgId ? activeTerms(svc, brokerOrgId, on) : Promise.resolve(null)]);
  return {
    brokerModel: brokerOrgId ? (broker?.model === "subscription" ? "subscription" : "revenue_share") : null,
    revenueSharePct: Number(broker?.revenue_share_pct ?? 0),
    platformFeePct: Number(insurer?.platform_fee_pct ?? 0),
    // The broker's agreed rate overrides the insurer's standard rate when set.
    brokerCommissionPct: Number(broker?.broker_commission_pct) || Number(insurer?.broker_commission_pct ?? 0),
  };
}

export function sourceOf(request: { source_broker_org_id: string | null }): BusinessSource {
  return request.source_broker_org_id ? "broker" : "covva";
}

export async function platformOrgId(svc: Svc): Promise<string | null> {
  const { data } = await svc.from("organizations").select("id").eq("type", "platform").order("created_at").limit(1).maybeSingle();
  return data?.id ?? null;
}

/** Compact record of a computed split, kept on `payments.raw_event.split` for the ledger. */
export interface SplitSummary {
  source: BusinessSource;
  total: number;
  insurer: number;
  broker: number;
  platform: number;
  broker_commission: number;
  revenue_share: number;
  platform_fee: number;
  insurer_org_id: string;
  broker_org_id: string | null;
  platform_org_id: string | null;
  split_code: string | null;
  terms: SplitTerms;
}

export interface PaymentSplit {
  split: Split;
  summary: SplitSummary;
  feeBreakdown: FeeBreakdown;
  quoteId: string;
  /** Body fields for Paystack: a split group when configured, else the insurer's subaccount. */
  paystackSettlement: { split_code: string } | { subaccount: string | null; bearer: "subaccount" };
}

/**
 * Compute the three-party split for a payment of `amount` (premium + taxes + fees +
 * selected benefits). Commission and fees are percentages of the net premium
 * (amount − taxes − fees).
 */
export async function splitForPayment(
  svc: Svc,
  args: {
    amount: number;
    quote: { id: string; premium: number; taxes: number; fees: number; currency: string; insurer_org_id: string; broker_org_id: string | null };
    request: { broker_org_id: string | null; source_broker_org_id: string | null };
    insurer: { id: string; name: string; paystack_subaccount_code: string | null; paystack_split_code?: string | null };
    provider: "paystack" | "simulator";
  },
): Promise<PaymentSplit> {
  const brokerOrgId = args.request.broker_org_id ?? args.quote.broker_org_id ?? null;
  const source = sourceOf(args.request);
  const [terms, platformId, broker] = await Promise.all([
    splitTermsFor(svc, args.insurer.id, brokerOrgId),
    platformOrgId(svc),
    brokerOrgId ? svc.from("organizations").select("name").eq("id", brokerOrgId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const taxes = Number(args.quote.taxes) || 0;
  const fees = Number(args.quote.fees) || 0;
  const premium = Math.max(0, Math.round((args.amount - taxes - fees) * 100) / 100);
  const input = { premium, taxes, fees, source, terms };
  const split = computeSplit(input);
  const feeBreakdown = feeBreakdownForQuote({ ...input, currency: args.quote.currency, insurerName: args.insurer.name, brokerName: broker.data?.name ?? null });
  const splitCode = args.provider === "paystack" ? args.insurer.paystack_split_code || process.env.PAYSTACK_SPLIT_GROUP_CODE || null : null;
  const summary: SplitSummary = {
    source,
    total: split.total,
    insurer: split.insurer,
    broker: split.broker,
    platform: split.platform,
    broker_commission: split.brokerCommission,
    revenue_share: split.revenueShare,
    platform_fee: split.platformFee,
    insurer_org_id: args.insurer.id,
    broker_org_id: brokerOrgId,
    platform_org_id: platformId,
    split_code: splitCode,
    terms,
  };
  return {
    split,
    summary,
    feeBreakdown,
    quoteId: args.quote.id,
    paystackSettlement: splitCode ? { split_code: splitCode } : { subaccount: args.insurer.paystack_subaccount_code, bearer: "subaccount" },
  };
}

/** Persist the split rows for a payment (idempotent per party) and the fee breakdown on the quote. */
export async function persistPaymentSplits(svc: Svc, paymentId: string, ps: PaymentSplit, subaccountCode: string | null): Promise<void> {
  const s = ps.summary;
  const rows: { payment_id: string; party: string; org_id: string | null; amount: number; pct: number | null; subaccount_code: string | null; provider_split_ref: string | null }[] = [
    { payment_id: paymentId, party: "insurer", org_id: s.insurer_org_id, amount: s.insurer, pct: null, subaccount_code: subaccountCode, provider_split_ref: s.split_code },
  ];
  if (s.broker_org_id && (s.broker_commission > 0 || s.broker > 0)) {
    rows.push({ payment_id: paymentId, party: "broker", org_id: s.broker_org_id, amount: s.broker, pct: s.terms.brokerCommissionPct, subaccount_code: null, provider_split_ref: s.split_code });
  }
  if (s.platform > 0) {
    rows.push({ payment_id: paymentId, party: "platform", org_id: s.platform_org_id, amount: s.platform, pct: s.terms.platformFeePct, subaccount_code: null, provider_split_ref: s.split_code });
  }
  const { error } = await svc.from("payment_splits").upsert(rows, { onConflict: "payment_id,party" });
  if (error) log.error("payments.split_persist_failed", { paymentId, err: error });
  await svc.from("quotes").update({ fee_breakdown: ps.feeBreakdown as unknown as Json }).eq("id", ps.quoteId);
}

/**
 * Fee transparency for a quote (customer checkout). Uses the stored breakdown when the
 * quote has one (set at payment initiation), otherwise computes it from the terms in force.
 */
export async function feeBreakdownForQuoteId(quoteId: string): Promise<FeeBreakdown | null> {
  const svc = createServiceClient();
  const { data: quote } = await svc
    .from("quotes")
    .select("id, premium, taxes, fees, currency, insurer_org_id, broker_org_id, fee_breakdown, request:requests!quotes_request_id_fkey(broker_org_id, source_broker_org_id)")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quote) return null;
  if (quote.fee_breakdown && typeof quote.fee_breakdown === "object") return quote.fee_breakdown as unknown as FeeBreakdown;
  const request = (quote.request as unknown as { broker_org_id: string | null; source_broker_org_id: string | null } | null) ?? { broker_org_id: null, source_broker_org_id: null };
  const brokerOrgId = request.broker_org_id ?? quote.broker_org_id ?? null;
  const ids = [quote.insurer_org_id, brokerOrgId].filter((x): x is string => !!x);
  const [{ data: orgs }, terms] = await Promise.all([svc.from("organizations").select("id, name").in("id", ids), splitTermsFor(svc, quote.insurer_org_id, brokerOrgId)]);
  const name = (id: string | null) => (orgs ?? []).find((o) => o.id === id)?.name ?? null;
  return feeBreakdownForQuote({
    premium: Number(quote.premium),
    taxes: Number(quote.taxes),
    fees: Number(quote.fees),
    source: sourceOf(request),
    terms,
    currency: quote.currency,
    insurerName: name(quote.insurer_org_id) ?? undefined,
    brokerName: name(brokerOrgId),
  });
}
