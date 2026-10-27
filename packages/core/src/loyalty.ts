/**
 * Loyalty and rewards rules engine (roadmap Phase 4; Addendum 6 item 6).
 *
 * Pure, deterministic evaluation shared by the web server (quotes and renewals), the partner workspace
 * (insurer rule editor), the admin console (platform fallback) and the customer loyalty page.
 *
 *   * A RULE SET belongs to one insurer (or is the platform fallback when `insurerOrgId` is null) and is
 *     immutable once published: every change is a new version (see public.publish_loyalty_rule_set).
 *   * Each RULE has a type, effective dates, its own caps, and the set has a stacking order and a maximum
 *     combined percentage. Percentage rules are applied to the BASE premium (never compounded) in stacking
 *     order; the first rule that would push the total over the combined cap is cut to the cap and later
 *     percentage rules are skipped. Referral credits are the customer's own credit balance redeemed against
 *     the premium (insurer-funded; bounded by the rule's own cap and by what is left to pay) and sit outside
 *     the percentage cap.
 *   * The result is a list of explicit DISCOUNT LINES with an explanation each: the base premium is never
 *     changed. Discounts are the insurer's money; Covva only records them.
 *
 * The SQL validation in private.validate_loyalty_rules mirrors validateLoyaltyRuleSet() — keep both in sync.
 */

export const LOYALTY_RULE_TYPES = ["no_claims", "loyalty_tier", "bundle", "early_renewal", "safe_driver", "referral_credit"] as const;
export type LoyaltyRuleType = (typeof LOYALTY_RULE_TYPES)[number];

export const LOYALTY_RULE_LABEL: Record<LoyaltyRuleType, string> = {
  no_claims: "No-claims discount",
  loyalty_tier: "Loyalty tier",
  bundle: "Bundle discount",
  early_renewal: "Early renewal",
  safe_driver: "Safe-driver discount",
  referral_credit: "Referral credit",
};

export const LOYALTY_RULE_HELP: Record<LoyaltyRuleType, string> = {
  no_claims: "A percentage off for each claim-free year with cover bought through Covva (tiers by years, capped). Policies the customer added themselves don't count: we can't verify their claims.",
  loyalty_tier: "A percentage off once the customer has been with this insurer for a number of years (tiers by years, with a name such as Silver or Gold).",
  bundle: "A percentage off when the customer buys two or more cover types together as a bundle.",
  early_renewal: "A percentage off when the customer renews a set number of days (or more) before the cover ends.",
  safe_driver: "Motor renewals only: a percentage off when the customer's consented phone-based driving score meets a threshold over enough months of data.",
  referral_credit: "Lets the customer redeem referral credits earned on Covva against this premium (the insurer funds the discount). The credit never exceeds the cap or the amount left to pay.",
};

/** Default stacking order: history-based discounts first, the customer's own credits last. */
export const DEFAULT_STACKING_ORDER: readonly LoyaltyRuleType[] = ["no_claims", "loyalty_tier", "bundle", "early_renewal", "safe_driver", "referral_credit"];
export const DEFAULT_MAX_COMBINED_PCT = 25;
export const MAX_CLAIM_FREE_YEARS = 5;

export interface LoyaltyTier {
  /** no_claims / loyalty_tier: claim-free years or years with the insurer. */
  years?: number;
  /** safe_driver: minimum average driving score (0–100). */
  score?: number;
  pct: number;
  /** Shown to the customer ("Silver", "Gold"). */
  name?: string;
}

export interface LoyaltyRule {
  /** Unique within the set: [a-z0-9_]{2,40}. */
  key: string;
  type: LoyaltyRuleType;
  label?: string;
  active: boolean;
  /** ISO dates (inclusive). Null = no bound. */
  effective_from?: string | null;
  effective_to?: string | null;
  /** Flat percentage (bundle, early_renewal). */
  pct?: number;
  /** Per-rule caps. */
  max_pct?: number;
  max_amount?: number;
  /** no_claims / loyalty_tier (years) and safe_driver (score). The highest matching tier wins. */
  tiers?: LoyaltyTier[];
  /** bundle: categories bought together (default 2). */
  min_categories?: number;
  /** early_renewal: renew at least this many days before the cover ends (default 14). */
  days_before_expiry?: number;
  /** safe_driver: months of scored data needed (default 3). */
  min_months?: number;
  /** Restrict to these category slugs (safe_driver defaults to motor). */
  categories?: string[];
  /** Only at renewal (safe_driver and early_renewal are always renewal-only). */
  renewal_only?: boolean;
}

export interface LoyaltyRuleSet {
  id?: string | null;
  /** Null = platform fallback (used when the insurer has no published set). */
  insurerOrgId: string | null;
  version: number;
  maxCombinedPct: number;
  stackingOrder: LoyaltyRuleType[];
  rules: LoyaltyRule[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface LoyaltyHistory {
  /** False when the customer has no Covva-issued policy history at all. */
  hasHistory: boolean;
  /** Consecutive claim-free years with cover through Covva, counted back from now (capped). */
  claimFreeYears: number;
  /** Whole years since the customer's first policy with THIS insurer (0 when none). */
  yearsWithInsurer: number;
  /** Whole years since the customer's first policy through Covva. */
  yearsOnCovva: number;
  /** The customer only has policies they added themselves (bought elsewhere): no verifiable history. */
  externalOnly: boolean;
}

export interface TelematicsSummary {
  /** Mean of the final monthly scores in the look-back window (0–100). */
  averageScore: number;
  /** Months with a final score in the window. */
  monthsOfData: number;
}

export interface LoyaltyContext {
  now: Date;
  /** Base premium (GHS) — never changed by the engine. */
  premium: number;
  currency?: string;
  categorySlug: string | null;
  insurerOrgId: string | null;
  isRenewal: boolean;
  /** Renewal: days between the quote and the expiring policy's cover end (null otherwise). */
  daysBeforeExpiry: number | null;
  history: LoyaltyHistory;
  /** Category slugs quoted together as one bundle (including this one). */
  bundleCategories: string[];
  /** Spendable referral credit balance (GHS). */
  creditBalance: number;
  /** Consented telematics summary for the policy being renewed (null = not enrolled / no data). */
  telematics: TelematicsSummary | null;
}

export interface DiscountLine {
  ruleKey: string;
  ruleType: LoyaltyRuleType;
  label: string;
  /** Plain-language "why" shown to the customer, broker and insurer. */
  explanation: string;
  /** Percentage rules are applied to the base premium; credits are a fixed amount. */
  basis: "premium" | "credit";
  pct: number | null;
  /** GHS taken off (positive). */
  amount: number;
  /** A cap (rule cap or combined cap) reduced this line. */
  capped: boolean;
  capNote?: string;
}

export interface SkippedRule {
  ruleKey: string;
  ruleType: LoyaltyRuleType;
  reason: string;
}

export interface LoyaltyEvaluation {
  insurerOrgId: string | null;
  ruleSetId: string | null;
  ruleSetVersion: number;
  premium: number;
  currency: string;
  lines: DiscountLine[];
  skipped: SkippedRule[];
  /** Sum of the percentage lines as a share of the base premium. */
  combinedPct: number;
  totalDiscount: number;
  netPremium: number;
  cappedByMaxCombined: boolean;
  /** One sentence for the customer ("You save GHS 120 (12%) on this quote."). */
  summary: string;
}

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
const round2 = (n: number) => Math.round(n * 100) / 100;
const KEY_RE = /^[a-z0-9_]{2,40}$/;

export function isLoyaltyRuleType(v: unknown): v is LoyaltyRuleType {
  return typeof v === "string" && (LOYALTY_RULE_TYPES as readonly string[]).includes(v);
}

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const dateStr = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Parses one rule from JSON (database row / form). Unknown fields are dropped; nothing is validated here. */
export function normaliseLoyaltyRule(raw: unknown): LoyaltyRule {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const tiers = Array.isArray(r.tiers)
    ? r.tiers
        .map((t) => {
          const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
          return { years: num(o.years), score: num(o.score), pct: num(o.pct) ?? 0, name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 40) : undefined };
        })
        .filter((t) => t.years !== undefined || t.score !== undefined)
    : undefined;
  return {
    key: typeof r.key === "string" ? r.key.trim().toLowerCase() : "",
    type: (isLoyaltyRuleType(r.type) ? r.type : "no_claims") as LoyaltyRuleType,
    label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 80) : undefined,
    active: r.active === true,
    effective_from: dateStr(r.effective_from),
    effective_to: dateStr(r.effective_to),
    pct: num(r.pct),
    max_pct: num(r.max_pct),
    max_amount: num(r.max_amount),
    tiers,
    min_categories: num(r.min_categories),
    days_before_expiry: num(r.days_before_expiry),
    min_months: num(r.min_months),
    categories: Array.isArray(r.categories) ? r.categories.filter((c): c is string => typeof c === "string" && !!c.trim()).map((c) => c.trim()) : undefined,
    renewal_only: typeof r.renewal_only === "boolean" ? r.renewal_only : undefined,
  };
}

/** Parses a rule-set row ({ id, insurer_org_id, version, max_combined_pct, stacking_order, rules, effective_from, effective_to }). */
export function normaliseLoyaltyRuleSet(raw: unknown): LoyaltyRuleSet {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const order = Array.isArray(r.stacking_order ?? r.stackingOrder) ? ((r.stacking_order ?? r.stackingOrder) as unknown[]).filter(isLoyaltyRuleType) : [];
  const rules = Array.isArray(r.rules) ? r.rules.map(normaliseLoyaltyRule) : [];
  return {
    id: typeof r.id === "string" ? r.id : null,
    insurerOrgId: typeof (r.insurer_org_id ?? r.insurerOrgId) === "string" ? ((r.insurer_org_id ?? r.insurerOrgId) as string) : null,
    version: num(r.version) ?? 1,
    maxCombinedPct: num(r.max_combined_pct ?? r.maxCombinedPct) ?? DEFAULT_MAX_COMBINED_PCT,
    stackingOrder: order.length ? order : [...DEFAULT_STACKING_ORDER],
    rules,
    effectiveFrom: dateStr(r.effective_from ?? r.effectiveFrom),
    effectiveTo: dateStr(r.effective_to ?? r.effectiveTo),
  };
}

/** "1:10, 2:20, 3:30" (years:pct) or "75:5, 90:10" (score:pct) → tiers. Invalid pairs are dropped. */
export function parseTierList(text: string, by: "years" | "score"): LoyaltyTier[] {
  const out: LoyaltyTier[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*(?:\(([^)]{1,40})\))?\s*$/.exec(part);
    if (!m) continue;
    const t: LoyaltyTier = { pct: Number(m[2]) };
    t[by] = Number(m[1]);
    if (m[3]) t.name = m[3].trim();
    out.push(t);
  }
  return out.sort((a, b) => (a[by] ?? 0) - (b[by] ?? 0));
}

export function formatTierList(tiers: LoyaltyTier[] | undefined, by: "years" | "score"): string {
  return (tiers ?? []).map((t) => `${t[by] ?? 0}:${t.pct}${t.name ? ` (${t.name})` : ""}`).join(", ");
}

const pctOk = (v: number | undefined) => v === undefined || (v >= 0 && v <= 100);

/**
 * Validation errors for a rule set (empty = valid). The same checks run in the database
 * (private.validate_loyalty_rules) so a set can never be published in a shape the engine cannot evaluate.
 */
export function validateLoyaltyRuleSet(set: Pick<LoyaltyRuleSet, "maxCombinedPct" | "stackingOrder" | "rules">): string[] {
  const errors: string[] = [];
  if (!(set.maxCombinedPct >= 0 && set.maxCombinedPct <= 100)) errors.push("The maximum combined discount must be between 0 and 100%.");
  if (new Set(set.stackingOrder).size !== set.stackingOrder.length) errors.push("The stacking order lists a rule type twice.");
  if (set.rules.length > 40) errors.push("At most 40 rules per set.");
  const keys = new Set<string>();
  for (const r of set.rules) {
    const where = r.key ? `Rule "${r.key}"` : "A rule";
    if (!KEY_RE.test(r.key)) errors.push(`${where}: the key must be 2–40 lower-case letters, digits or underscores.`);
    if (keys.has(r.key)) errors.push(`${where}: duplicate key.`);
    keys.add(r.key);
    if (!isLoyaltyRuleType(r.type)) errors.push(`${where}: unknown rule type.`);
    if (!pctOk(r.pct)) errors.push(`${where}: the percentage must be between 0 and 100.`);
    if (!pctOk(r.max_pct)) errors.push(`${where}: the maximum percentage must be between 0 and 100.`);
    if (r.max_amount !== undefined && r.max_amount < 0) errors.push(`${where}: the maximum amount cannot be negative.`);
    if (r.effective_from && r.effective_to && r.effective_to < r.effective_from) errors.push(`${where}: the end date is before the start date.`);
    if (r.min_categories !== undefined && (r.min_categories < 2 || r.min_categories > 10)) errors.push(`${where}: a bundle needs between 2 and 10 cover types.`);
    if (r.days_before_expiry !== undefined && (r.days_before_expiry < 1 || r.days_before_expiry > 120)) errors.push(`${where}: the early-renewal window must be 1–120 days.`);
    if (r.min_months !== undefined && (r.min_months < 1 || r.min_months > 24)) errors.push(`${where}: months of data must be 1–24.`);
    for (const t of r.tiers ?? []) {
      if (!pctOk(t.pct)) errors.push(`${where}: a tier percentage is outside 0–100.`);
      if (t.years !== undefined && (t.years < 0 || t.years > 50)) errors.push(`${where}: tier years must be 0–50.`);
      if (t.score !== undefined && (t.score < 0 || t.score > 100)) errors.push(`${where}: tier score must be 0–100.`);
    }
    const needsTiers = r.type === "no_claims" || r.type === "loyalty_tier" || r.type === "safe_driver";
    if (r.active && needsTiers && !(r.tiers ?? []).some((t) => t.pct > 0)) errors.push(`${where}: add at least one tier with a percentage above 0.`);
    if (r.active && (r.type === "bundle" || r.type === "early_renewal") && !((r.pct ?? 0) > 0)) errors.push(`${where}: set a percentage above 0.`);
    if (r.active && r.type === "referral_credit" && !((r.max_pct ?? 0) > 0 || (r.max_amount ?? 0) > 0)) errors.push(`${where}: set a maximum percentage or amount for credit redemption.`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// History helpers (claim-free years, years with the insurer)
// ---------------------------------------------------------------------------
export interface HistoryPolicy {
  id: string;
  status: string;
  coverStart: string | null;
  coverEnd: string | null;
  issuedAt?: string | null;
  externalSource: boolean;
  insurerOrgId: string | null;
}

export interface HistoryClaim {
  policyId: string;
  status: string;
  /** Incident date, else when it was reported. */
  incidentAt: string | null;
  createdAt: string;
}

/** Claim statuses that do not count against the customer. */
const CLAIM_IGNORED = new Set(["draft", "withdrawn", "rejected"]);
/** Policy statuses that never provided cover. */
const POLICY_NOT_COVER = new Set(["pending_issuance", "cancelled"]);

const ms = (v: string | null | undefined) => (v ? Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v) : NaN);

/** Days of cover a year needs (union of all Covva policies) to count towards claim-free years. */
export const CLAIM_FREE_MIN_COVER_DAYS = 180;

/** Days covered within [start, end) by the union of the intervals. */
function coveredDays(intervals: { s: number; e: number }[], start: number, end: number): number {
  const clipped = intervals.map((i) => ({ s: Math.max(i.s, start), e: Math.min(i.e, end) })).filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  let total = 0;
  let cur: { s: number; e: number } | null = null;
  for (const i of clipped) {
    if (cur && i.s <= cur.e) cur.e = Math.max(cur.e, i.e);
    else {
      if (cur) total += cur.e - cur.s;
      cur = { ...i };
    }
  }
  if (cur) total += cur.e - cur.s;
  return total / DAY_MS;
}

/**
 * Claim-free years and tenure from the customer's policies and claims. Only policies arranged through
 * Covva count (external policies are shown but cannot be verified). A year (counted back from now) is
 * claim-free when Covva policies covered at least CLAIM_FREE_MIN_COVER_DAYS of it and no claim (other
 * than drafts, withdrawn or rejected ones) falls in it. Counting stops at the first year that fails.
 */
export function claimHistory(policies: HistoryPolicy[], claims: HistoryClaim[], insurerOrgId: string | null, now: Date = new Date()): LoyaltyHistory {
  const covva = policies.filter((p) => !p.externalSource && !POLICY_NOT_COVER.has(p.status) && Number.isFinite(ms(p.coverStart)));
  const externalOnly = covva.length === 0 && policies.some((p) => p.externalSource);
  if (!covva.length) return { hasHistory: false, claimFreeYears: 0, yearsWithInsurer: 0, yearsOnCovva: 0, externalOnly };
  const covvaIds = new Set(covva.map((p) => p.id));
  const claimTimes = claims
    .filter((c) => covvaIds.has(c.policyId) && !CLAIM_IGNORED.has(c.status))
    .map((c) => (Number.isFinite(ms(c.incidentAt)) ? ms(c.incidentAt) : ms(c.createdAt)))
    .filter((t) => Number.isFinite(t));
  const end = now.getTime();
  let claimFreeYears = 0;
  for (let i = 0; i < MAX_CLAIM_FREE_YEARS; i++) {
    const winEnd = end - i * YEAR_MS;
    const winStart = winEnd - YEAR_MS;
    const days = coveredDays(
      covva.map((p) => ({ s: ms(p.coverStart), e: Number.isFinite(ms(p.coverEnd)) ? ms(p.coverEnd) + DAY_MS : end })),
      winStart,
      winEnd,
    );
    if (days < CLAIM_FREE_MIN_COVER_DAYS) break;
    if (claimTimes.some((t) => t >= winStart && t < winEnd)) break;
    claimFreeYears++;
  }
  const first = Math.min(...covva.map((p) => ms(p.coverStart)));
  const firstWithInsurer = insurerOrgId ? Math.min(...covva.filter((p) => p.insurerOrgId === insurerOrgId).map((p) => ms(p.coverStart)), Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
  const years = (t: number) => (Number.isFinite(t) && t < end ? Math.floor((end - t) / YEAR_MS) : 0);
  return { hasHistory: true, claimFreeYears, yearsWithInsurer: years(firstWithInsurer), yearsOnCovva: years(first), externalOnly: false };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function inEffect(from: string | null | undefined, to: string | null | undefined, today: string): boolean {
  if (from && today < from) return false;
  if (to && today > to) return false;
  return true;
}

function highestTier(tiers: LoyaltyTier[] | undefined, by: "years" | "score", value: number): LoyaltyTier | null {
  let best: LoyaltyTier | null = null;
  for (const t of tiers ?? []) {
    const threshold = t[by];
    if (threshold === undefined || value < threshold || !(t.pct > 0)) continue;
    if (!best || threshold > (best[by] ?? 0)) best = t;
  }
  return best;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pctText = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;

type Decision = { pct: number; explanation: string; label: string } | { skip: string };

function decide(rule: LoyaltyRule, ctx: LoyaltyContext): Decision {
  const label = rule.label ?? LOYALTY_RULE_LABEL[rule.type];
  const today = isoDay(ctx.now);
  if (!rule.active) return { skip: "Rule is switched off" };
  if (!inEffect(rule.effective_from, rule.effective_to, today)) return { skip: rule.effective_from && today < rule.effective_from ? `Rule starts on ${rule.effective_from}` : `Rule ended on ${rule.effective_to}` };
  const renewalOnly = rule.renewal_only || rule.type === "early_renewal" || rule.type === "safe_driver";
  if (renewalOnly && !ctx.isRenewal) return { skip: "Applies at renewal only" };
  const cats = rule.categories?.length ? rule.categories : rule.type === "safe_driver" ? ["motor"] : [];
  if (cats.length && (!ctx.categorySlug || !cats.includes(ctx.categorySlug))) return { skip: `Applies to ${cats.join(", ")} cover only` };

  switch (rule.type) {
    case "no_claims": {
      if (!ctx.history.hasHistory) return { skip: ctx.history.externalOnly ? "Only cover bought through Covva counts towards no-claims years (policies you added yourself can't be verified)" : "No claims history on Covva yet" };
      const tier = highestTier(rule.tiers, "years", ctx.history.claimFreeYears);
      if (!tier) return { skip: ctx.history.claimFreeYears === 0 ? "A claim-free year is needed first" : `${plural(ctx.history.claimFreeYears, "claim-free year")} is below the first tier` };
      return { pct: tier.pct, label, explanation: `${plural(ctx.history.claimFreeYears, "claim-free year")} with cover through Covva: ${pctText(tier.pct)} off the premium (the insurer's no-claims discount).` };
    }
    case "loyalty_tier": {
      const years = ctx.history.yearsWithInsurer;
      const tier = highestTier(rule.tiers, "years", years);
      if (!tier) return { skip: years === 0 ? "First year with this insurer" : `${plural(years, "year")} with this insurer is below the first tier` };
      return { pct: tier.pct, label: tier.name ? `${label} · ${tier.name}` : label, explanation: `${tier.name ? `${tier.name} tier: ` : ""}${plural(years, "year")} with this insurer earns ${pctText(tier.pct)} off the premium.` };
    }
    case "bundle": {
      const min = rule.min_categories ?? 2;
      const n = new Set(ctx.bundleCategories).size;
      if (n < min) return { skip: n <= 1 ? "Not part of a bundle" : `Bundle has ${n} cover types; ${min} needed` };
      return { pct: rule.pct ?? 0, label, explanation: `${plural(n, "cover type")} bought together as a bundle: ${pctText(rule.pct ?? 0)} off this premium.` };
    }
    case "early_renewal": {
      const window = rule.days_before_expiry ?? 14;
      if (ctx.daysBeforeExpiry === null) return { skip: "Expiry date unknown" };
      if (ctx.daysBeforeExpiry < window) return { skip: `Renew at least ${plural(window, "day")} before the cover ends to qualify` };
      return { pct: rule.pct ?? 0, label, explanation: `Renewing ${plural(ctx.daysBeforeExpiry, "day")} before the cover ends (${window}-day early-renewal window): ${pctText(rule.pct ?? 0)} off.` };
    }
    case "safe_driver": {
      const minMonths = rule.min_months ?? 3;
      if (!ctx.telematics) return { skip: "Not enrolled in phone-based driving scoring (or no scored months yet)" };
      if (ctx.telematics.monthsOfData < minMonths) return { skip: `${plural(ctx.telematics.monthsOfData, "scored month")} so far; ${minMonths} needed` };
      const tier = highestTier(rule.tiers, "score", ctx.telematics.averageScore);
      if (!tier) return { skip: `Average driving score ${ctx.telematics.averageScore} is below the threshold` };
      return { pct: tier.pct, label, explanation: `Average driving score ${ctx.telematics.averageScore} over ${plural(ctx.telematics.monthsOfData, "month")} (you chose to share it): ${pctText(tier.pct)} safe-driver discount.` };
    }
    case "referral_credit":
      return { pct: 0, label, explanation: "" }; // handled in evaluateLoyalty (fixed amount)
  }
}

/**
 * Evaluate a rule set for one quote. Deterministic: the same inputs always give the same lines.
 * Percentage lines use the base premium; caps are applied in stacking order; referral credits last.
 */
export function evaluateLoyalty(set: LoyaltyRuleSet, ctx: LoyaltyContext): LoyaltyEvaluation {
  const currency = ctx.currency ?? "GHS";
  const premium = round2(Math.max(0, ctx.premium));
  const base: LoyaltyEvaluation = {
    insurerOrgId: set.insurerOrgId,
    ruleSetId: set.id ?? null,
    ruleSetVersion: set.version,
    premium,
    currency,
    lines: [],
    skipped: [],
    combinedPct: 0,
    totalDiscount: 0,
    netPremium: premium,
    cappedByMaxCombined: false,
    summary: "No discounts apply to this quote.",
  };
  const today = isoDay(ctx.now);
  if (!inEffect(set.effectiveFrom, set.effectiveTo, today)) {
    base.skipped = set.rules.map((r) => ({ ruleKey: r.key, ruleType: r.type, reason: "Rule set is not in effect" }));
    return base;
  }
  if (!(premium > 0)) {
    base.skipped = set.rules.map((r) => ({ ruleKey: r.key, ruleType: r.type, reason: "No premium to discount" }));
    return base;
  }
  const order = (t: LoyaltyRuleType) => {
    const i = set.stackingOrder.indexOf(t);
    return i === -1 ? DEFAULT_STACKING_ORDER.indexOf(t) + 100 : i;
  };
  const rules = [...set.rules].sort((a, b) => order(a.type) - order(b.type) || a.key.localeCompare(b.key));
  const cap = round2((premium * Math.min(100, Math.max(0, set.maxCombinedPct))) / 100);
  let pctTotal = 0;
  let creditTotal = 0;
  const seen = new Set<LoyaltyRuleType>();

  for (const rule of rules) {
    const d = decide(rule, ctx);
    if ("skip" in d) {
      base.skipped.push({ ruleKey: rule.key, ruleType: rule.type, reason: d.skip });
      continue;
    }
    // One line per rule type: overlapping rules of the same type don't stack (first in order wins).
    if (seen.has(rule.type)) {
      base.skipped.push({ ruleKey: rule.key, ruleType: rule.type, reason: `Another ${LOYALTY_RULE_LABEL[rule.type].toLowerCase()} rule already applied` });
      continue;
    }

    if (rule.type === "referral_credit") {
      const remaining = round2(premium - pctTotal - creditTotal);
      const byPct = rule.max_pct !== undefined ? round2((premium * rule.max_pct) / 100) : Number.POSITIVE_INFINITY;
      const byAmount = rule.max_amount !== undefined ? rule.max_amount : Number.POSITIVE_INFINITY;
      const available = round2(Math.max(0, ctx.creditBalance));
      if (!(available > 0)) {
        base.skipped.push({ ruleKey: rule.key, ruleType: rule.type, reason: "No referral credit to redeem" });
        continue;
      }
      const amount = round2(Math.max(0, Math.min(available, byPct, byAmount, remaining)));
      if (!(amount > 0)) {
        base.skipped.push({ ruleKey: rule.key, ruleType: rule.type, reason: "Nothing left to pay after other discounts" });
        continue;
      }
      const capped = amount < available;
      creditTotal = round2(creditTotal + amount);
      seen.add(rule.type);
      base.lines.push({
        ruleKey: rule.key,
        ruleType: rule.type,
        label: d.label,
        explanation: `${currency} ${amount.toFixed(2)} of your referral credit (balance ${currency} ${available.toFixed(2)}) comes off this premium. The insurer funds this discount; credits are not cash.`,
        basis: "credit",
        pct: null,
        amount,
        capped,
        capNote: capped ? (amount === remaining ? "Limited to the amount left to pay" : `Limited to ${rule.max_pct !== undefined && amount === byPct ? pctText(rule.max_pct) + " of the premium" : `${currency} ${byAmount.toFixed(2)}`} per policy`) : undefined,
      });
      continue;
    }

    let pct = d.pct;
    let capped = false;
    let capNote: string | undefined;
    if (rule.max_pct !== undefined && pct > rule.max_pct) {
      pct = rule.max_pct;
      capped = true;
      capNote = `Capped at ${pctText(rule.max_pct)} by the insurer`;
    }
    let amount = round2((premium * pct) / 100);
    if (rule.max_amount !== undefined && amount > rule.max_amount) {
      amount = round2(rule.max_amount);
      capped = true;
      capNote = `Capped at ${currency} ${rule.max_amount.toFixed(2)} by the insurer`;
    }
    if (round2(pctTotal + amount) > cap) {
      const room = round2(cap - pctTotal);
      if (!(room > 0)) {
        base.cappedByMaxCombined = true;
        base.skipped.push({ ruleKey: rule.key, ruleType: rule.type, reason: `Maximum combined discount of ${pctText(set.maxCombinedPct)} already reached` });
        continue;
      }
      amount = room;
      capped = true;
      base.cappedByMaxCombined = true;
      capNote = `Reduced so all discounts together stay within the insurer's ${pctText(set.maxCombinedPct)} maximum`;
    }
    if (!(amount > 0)) {
      base.skipped.push({ ruleKey: rule.key, ruleType: rule.type, reason: "Rule gives 0%" });
      continue;
    }
    pctTotal = round2(pctTotal + amount);
    seen.add(rule.type);
    base.lines.push({ ruleKey: rule.key, ruleType: rule.type, label: d.label, explanation: d.explanation, basis: "premium", pct, amount, capped, capNote });
  }

  base.totalDiscount = round2(pctTotal + creditTotal);
  base.netPremium = round2(Math.max(0, premium - base.totalDiscount));
  base.combinedPct = premium > 0 ? Math.round((pctTotal / premium) * 1000) / 10 : 0;
  if (base.totalDiscount > 0) {
    const share = Math.round((base.totalDiscount / premium) * 1000) / 10;
    base.summary = `You save ${currency} ${base.totalDiscount.toFixed(2)} (${share}%) on this quote: ${base.lines.map((l) => l.label.toLowerCase()).join(", ")}.`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Customer loyalty page helpers
// ---------------------------------------------------------------------------
export interface LoyaltyTierStatus {
  name: string;
  pct: number;
  years: number;
  next: { name: string; years: number; pct: number; yearsToGo: number } | null;
}

/** The customer's loyalty tier under a rule set's loyalty_tier rule (null when the insurer has none). */
export function loyaltyTierStatus(set: LoyaltyRuleSet, yearsWithInsurer: number): LoyaltyTierStatus | null {
  const rule = set.rules.find((r) => r.type === "loyalty_tier" && r.active);
  if (!rule?.tiers?.length) return null;
  const tiers = [...rule.tiers].filter((t) => t.years !== undefined && t.pct > 0).sort((a, b) => (a.years ?? 0) - (b.years ?? 0));
  if (!tiers.length) return null;
  const current = highestTier(tiers, "years", yearsWithInsurer);
  const next = tiers.find((t) => (t.years ?? 0) > yearsWithInsurer) ?? null;
  const name = (t: LoyaltyTier, i: number) => t.name ?? `Tier ${i + 1}`;
  return {
    name: current ? name(current, tiers.indexOf(current)) : "Starter",
    pct: current?.pct ?? 0,
    years: yearsWithInsurer,
    next: next ? { name: name(next, tiers.indexOf(next)), years: next.years ?? 0, pct: next.pct, yearsToGo: Math.max(1, (next.years ?? 0) - yearsWithInsurer) } : null,
  };
}

export interface RenewalPerk {
  ruleKey: string;
  ruleType: LoyaltyRuleType;
  label: string;
  /** What the customer can expect, or what they still need to do. */
  text: string;
  /** True when the customer already qualifies on today's facts. */
  qualifies: boolean;
}

/**
 * Upcoming renewal perks for one active policy: what each active rule would give at renewal and what is
 * still needed. Uses the same evaluation as the quote so the two never disagree.
 */
export function renewalPerks(set: LoyaltyRuleSet, ctx: Omit<LoyaltyContext, "isRenewal" | "daysBeforeExpiry"> & { daysBeforeExpiry: number | null }): RenewalPerk[] {
  const evaluation = evaluateLoyalty(set, { ...ctx, isRenewal: true });
  const out: RenewalPerk[] = [];
  for (const line of evaluation.lines) out.push({ ruleKey: line.ruleKey, ruleType: line.ruleType, label: line.label, text: line.explanation, qualifies: true });
  for (const s of evaluation.skipped) {
    const rule = set.rules.find((r) => r.key === s.ruleKey);
    if (!rule?.active || s.reason.startsWith("Rule ") || s.reason.startsWith("Applies to ") || s.reason.startsWith("Another ")) continue;
    out.push({ ruleKey: s.ruleKey, ruleType: s.ruleType, label: rule.label ?? LOYALTY_RULE_LABEL[rule.type], text: s.reason, qualifies: false });
  }
  return out;
}

/** Plain-language "how to earn more" tips, from the rules that exist (never gamified). */
export function howToEarnMore(set: LoyaltyRuleSet): string[] {
  const tips: string[] = [];
  for (const r of set.rules) {
    if (!r.active) continue;
    switch (r.type) {
      case "no_claims":
        tips.push("Each claim-free year with cover through Covva can lower your premium at the next quote or renewal.");
        break;
      case "loyalty_tier":
        tips.push("Staying with the same insurer year after year moves you up their loyalty tiers.");
        break;
      case "bundle":
        tips.push(`Buying ${r.min_categories ?? 2} or more cover types together as a bundle gives ${pctText(r.pct ?? 0)} off each.`);
        break;
      case "early_renewal":
        tips.push(`Renew at least ${plural(r.days_before_expiry ?? 14, "day")} before your cover ends for ${pctText(r.pct ?? 0)} off.`);
        break;
      case "safe_driver":
        tips.push("Motor policies: share your phone-based driving score (with your consent) and a good score earns a discount at renewal.");
        break;
      case "referral_credit":
        tips.push("Referral credits you have earned can come off a premium where the insurer supports it.");
        break;
    }
  }
  return [...new Set(tips)];
}

/** The platform fallback seeded by the migration: every rule present but switched OFF until an insurer signs off. */
export const DEFAULT_LOYALTY_RULES: LoyaltyRule[] = [
  { key: "no_claims", type: "no_claims", active: false, tiers: [{ years: 1, pct: 10 }, { years: 2, pct: 15 }, { years: 3, pct: 20 }, { years: 5, pct: 25 }], max_pct: 25 },
  { key: "loyalty_tier", type: "loyalty_tier", active: false, tiers: [{ years: 2, pct: 2, name: "Silver" }, { years: 4, pct: 4, name: "Gold" }] },
  { key: "bundle", type: "bundle", active: false, pct: 5, min_categories: 2 },
  { key: "early_renewal", type: "early_renewal", active: false, pct: 3, days_before_expiry: 14 },
  { key: "safe_driver", type: "safe_driver", active: false, tiers: [{ score: 75, pct: 5 }, { score: 90, pct: 10 }], min_months: 3, categories: ["motor"] },
  { key: "referral_credit", type: "referral_credit", active: false, max_pct: 10 },
];

/** Honest copy shown wherever discount lines appear. */
export const LOYALTY_DISCOUNT_NOTE = "Discounts are set and funded by the insurer, never by Covva, and never change which insurers or products you see or the order they appear in. The insurer confirms the final price.";

// ---------------------------------------------------------------------------
// Rule editor form (partner workspace + admin console share this shape)
// ---------------------------------------------------------------------------
/** Flat form field names: `<type>_<field>`; plus `max_combined_pct`, `effective_from`, `effective_to`, `note`. */
export type LoyaltyFormValues = Record<string, string>;

const tierBy = (t: LoyaltyRuleType): "years" | "score" => (t === "safe_driver" ? "score" : "years");

/** The flat form values for an existing rule set (one rule per type; extras are ignored). */
export function loyaltyFormValues(set: LoyaltyRuleSet | null): LoyaltyFormValues {
  const out: LoyaltyFormValues = {
    max_combined_pct: String(set?.maxCombinedPct ?? DEFAULT_MAX_COMBINED_PCT),
    effective_from: set?.effectiveFrom ?? "",
    effective_to: set?.effectiveTo ?? "",
    note: "",
  };
  for (const type of LOYALTY_RULE_TYPES) {
    const r = set?.rules.find((x) => x.type === type) ?? DEFAULT_LOYALTY_RULES.find((x) => x.type === type)!;
    out[`${type}_active`] = r.active ? "on" : "";
    out[`${type}_tiers`] = formatTierList(r.tiers, tierBy(type));
    out[`${type}_pct`] = r.pct !== undefined ? String(r.pct) : "";
    out[`${type}_max_pct`] = r.max_pct !== undefined ? String(r.max_pct) : "";
    out[`${type}_max_amount`] = r.max_amount !== undefined ? String(r.max_amount) : "";
    out[`${type}_min_categories`] = r.min_categories !== undefined ? String(r.min_categories) : "";
    out[`${type}_days`] = r.days_before_expiry !== undefined ? String(r.days_before_expiry) : "";
    out[`${type}_min_months`] = r.min_months !== undefined ? String(r.min_months) : "";
    out[`${type}_from`] = r.effective_from ?? "";
    out[`${type}_to`] = r.effective_to ?? "";
  }
  return out;
}

/** Rules from the flat form values (one rule per type, key = type). Numbers that don't parse are left unset. */
export function loyaltyRulesFromForm(values: Record<string, unknown>): { rules: LoyaltyRule[]; maxCombinedPct: number; effectiveFrom: string | null; effectiveTo: string | null; note: string | null } {
  const str = (k: string) => (typeof values[k] === "string" ? (values[k] as string).trim() : "");
  const n = (k: string) => {
    const v = str(k);
    return v === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(str(k)) ? str(k) : null);
  const rules: LoyaltyRule[] = LOYALTY_RULE_TYPES.map((type) => {
    const rule: LoyaltyRule = { key: type, type, active: ["on", "true", "1"].includes(str(`${type}_active`).toLowerCase()) };
    const from = date(`${type}_from`);
    const to = date(`${type}_to`);
    if (from) rule.effective_from = from;
    if (to) rule.effective_to = to;
    switch (type) {
      case "no_claims":
        rule.tiers = parseTierList(str(`${type}_tiers`), "years");
        if (n(`${type}_max_pct`) !== undefined) rule.max_pct = n(`${type}_max_pct`);
        break;
      case "loyalty_tier":
        rule.tiers = parseTierList(str(`${type}_tiers`), "years");
        break;
      case "bundle":
        if (n(`${type}_pct`) !== undefined) rule.pct = n(`${type}_pct`);
        rule.min_categories = n(`${type}_min_categories`) ?? 2;
        break;
      case "early_renewal":
        if (n(`${type}_pct`) !== undefined) rule.pct = n(`${type}_pct`);
        rule.days_before_expiry = n(`${type}_days`) ?? 14;
        break;
      case "safe_driver":
        rule.tiers = parseTierList(str(`${type}_tiers`), "score");
        rule.min_months = n(`${type}_min_months`) ?? 3;
        rule.categories = ["motor"];
        break;
      case "referral_credit":
        if (n(`${type}_max_pct`) !== undefined) rule.max_pct = n(`${type}_max_pct`);
        if (n(`${type}_max_amount`) !== undefined) rule.max_amount = n(`${type}_max_amount`);
        break;
    }
    return rule;
  });
  return { rules, maxCombinedPct: n("max_combined_pct") ?? DEFAULT_MAX_COMBINED_PCT, effectiveFrom: date("effective_from"), effectiveTo: date("effective_to"), note: str("note") || null };
}
