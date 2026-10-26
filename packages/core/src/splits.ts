/**
 * Three-party checkout split (insurer / broker / Covva) and customer fee transparency.
 * Pure domain logic (Addendum 2 §F monetisation, §G transparency).
 *
 * Money rules:
 *  - The customer pays premium + taxes + fees. Covva never holds that money: it settles to
 *    the insurer, and the broker / platform shares are commission and fee portions only.
 *  - Arithmetic is done in pesewas (integer minor units), percentages rounded half up to
 *    2 dp, and any rounding remainder goes to the insurer so the parts always sum to the total.
 *  - Broker-sourced business: the broker keeps its whole commission; Covva's platform fee
 *    comes from the insurer side only (no revenue share).
 *  - Covva-sourced business + revenue-share broker: Covva takes `revenueSharePct` of the
 *    broker's commission; the insurer-side platform fee applies as configured.
 *  - Subscription broker: keeps its full commission; no revenue share.
 *  - Insurer-direct (no broker): no broker share.
 */
export type BusinessSource = "covva" | "broker";
export type BrokerModel = "revenue_share" | "subscription";

export interface SplitTerms {
  /** The broker's commercial model, or null when there is no broker of record. */
  brokerModel: BrokerModel | null;
  /** Covva's share of the broker's commission on Covva-sourced business (revenue-share brokers). */
  revenueSharePct: number;
  /** Insurer-side platform fee as % of the net premium. */
  platformFeePct: number;
  /** Broker commission as % of the net premium (paid by the insurer out of the premium). */
  brokerCommissionPct: number;
}

export interface SplitInput {
  premium: number;
  taxes?: number;
  fees?: number;
  source: BusinessSource;
  terms: SplitTerms;
}

export interface Split {
  /** Amount the customer pays (premium + taxes + fees), 2 dp. */
  total: number;
  /** Settles to the insurer (total − broker − platform; absorbs rounding). */
  insurer: number;
  /** Broker's net commission after any revenue share. */
  broker: number;
  /** Covva's take: insurer-side platform fee + revenue share of the broker's commission. */
  platform: number;
  /** Broker commission before revenue share. */
  brokerCommission: number;
  /** Portion of the broker commission that goes to Covva. */
  revenueShare: number;
  /** Insurer-side platform fee. */
  platformFee: number;
  source: BusinessSource;
}

/** Customer-facing breakdown stored on `quotes.fee_breakdown`. Amounts in major units (GHS). */
export interface FeeBreakdown {
  currency: string;
  premium: number;
  taxes: number;
  fees: number;
  /** Covva's platform fee — paid by the insurer out of the premium, not added on top. */
  platform_fee: number;
  /** Broker commission — paid by the insurer out of the premium, not added on top. */
  broker_commission: number;
  /** What the customer pays. Always premium + taxes + fees. */
  total: number;
  source: BusinessSource;
  notes: string[];
}

/** Pesewas (integer minor units) from a major-unit amount. */
const toMinor = (n: number | undefined | null): number => Math.round((Number(n) || 0) * 100);
const fromMinor = (m: number): number => m / 100;

/**
 * `minor × pct / 100`, rounded half up to the nearest pesewa. Percentages are taken to
 * 2 dp (the ledger's `numeric(5,2)`), and the integer arithmetic stays exact for amounts
 * up to GH₵ 9 billion (Number.MAX_SAFE_INTEGER / 10,000).
 */
export function pctOfMinor(minor: number, pct: number): number {
  if (!(pct > 0) || !(minor > 0)) return 0;
  const hundredths = Math.round(pct * 100); // pct with 2 dp → scale 1e4
  return Math.floor((minor * hundredths + 5_000) / 10_000);
}

/** Round a major-unit amount half up to 2 dp (what the ledger stores). */
export function roundMoney(n: number): number {
  return fromMinor(toMinor(n));
}

export function computeSplit(input: SplitInput): Split {
  const premium = toMinor(input.premium);
  const taxes = toMinor(input.taxes);
  const fees = toMinor(input.fees);
  if (premium < 0 || taxes < 0 || fees < 0) throw new RangeError("Amounts must not be negative");
  const total = premium + taxes + fees;
  const t = input.terms;
  const hasBroker = t.brokerModel !== null;

  // Commission and fee are percentages of the NET premium (not taxes or fees).
  const brokerCommission = hasBroker ? pctOfMinor(premium, t.brokerCommissionPct) : 0;
  const platformFee = pctOfMinor(premium, t.platformFeePct);
  const revenueShare = hasBroker && input.source === "covva" && t.brokerModel === "revenue_share" ? pctOfMinor(brokerCommission, t.revenueSharePct) : 0;

  let broker = brokerCommission - revenueShare;
  let platform = platformFee + revenueShare;
  // Commission and fees can never exceed what was paid: cap, insurer share is never negative.
  if (broker + platform > total) {
    const over = broker + platform - total;
    platform = platform >= over ? platform - over : 0;
    const rest = broker + platform - total;
    if (rest > 0) broker -= rest;
  }
  const insurer = total - broker - platform;

  return {
    total: fromMinor(total),
    insurer: fromMinor(insurer),
    broker: fromMinor(broker),
    platform: fromMinor(platform),
    brokerCommission: fromMinor(brokerCommission),
    revenueShare: fromMinor(revenueShare),
    platformFee: fromMinor(platformFee),
    source: input.source,
  };
}

/** Transparency block for a quote: what the customer pays and what the insurer pays out of it. */
export function feeBreakdownForQuote(input: SplitInput & { currency?: string; insurerName?: string; brokerName?: string | null }): FeeBreakdown {
  const split = computeSplit(input);
  const insurer = input.insurerName ?? "the insurer";
  const notes: string[] = [`You pay ${insurer} directly through an authorised payment provider. Covva never holds your premium.`];
  if (split.brokerCommission > 0) {
    notes.push(`${input.brokerName ?? "Your broker"}'s commission is paid by ${insurer} out of the premium — it is not added to your price.`);
  }
  if (split.platformFee > 0) notes.push(`Covva's platform fee is paid by ${insurer} out of the premium — it is not added to your price.`);
  if (split.revenueShare > 0) notes.push("Covva receives a share of the broker's commission for introducing this business. Your price is unaffected.");
  return {
    currency: input.currency ?? "GHS",
    premium: roundMoney(input.premium),
    taxes: roundMoney(input.taxes ?? 0),
    fees: roundMoney(input.fees ?? 0),
    platform_fee: split.platformFee,
    broker_commission: split.brokerCommission,
    total: split.total,
    source: input.source,
    notes,
  };
}
