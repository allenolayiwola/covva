/**
 * Referrals and embedded distribution (roadmap Phase 3; Addendum 6 item 6).
 *
 * Pure helpers shared by the web server, the partner/admin consoles and the mobile app:
 * referral codes, the `covva_ref` cookie, reward rule evaluation (with the holding
 * period), the partner revenue share (a share of COVVA'S PLATFORM FEE only — never of
 * the premium) and the WCAG AA check for partner brand colours.
 *
 * Referral credits are GHS credit units, not cash. They are redeemable only against
 * Covva's own platform fees, or a future premium where the insurer funds the discount.
 * Rewards never influence which insurer or product is shown, nor the comparison order.
 */
import { DEFAULT_PLATFORM_NAME } from "./disclosure";

/** RFC 4648 base32 alphabet: no 0/1/8/9, so codes survive being read out over the phone. */
export const REFERRAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const REFERRAL_CODE_RE = /^[A-Z2-7]{8}$/;
export const REFERRAL_COOKIE = "covva_ref";
/** How long a referral touch counts: the cookie lives this long and older first touches are ignored. */
export const attributionWindowDays = 30;
/** Default holding period before rewards / revenue share are posted (cooling-off cancellations). */
export const DEFAULT_HOLDING_DAYS = 14;
export const REFERRAL_SOURCES = ["link", "widget", "api"] as const;
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];
export const PARTNER_SEGMENTS = ["car_dealer", "bank", "landlord", "fleet", "travel_agent", "remittance", "employer", "other"] as const;
export type PartnerSegment = (typeof PARTNER_SEGMENTS)[number];
export const PARTNER_SEGMENT_LABEL: Record<PartnerSegment, string> = {
  car_dealer: "Car dealer",
  bank: "Bank / lender",
  landlord: "Landlord / property manager",
  fleet: "Fleet / ride-hailing",
  travel_agent: "Travel agent",
  remittance: "Remittance provider",
  employer: "Employer",
  other: "Other",
};

/** Mandatory disclosure shown on every embedded surface (widget, partner API responses). */
export const EMBED_DISCLOSURE = `Technology provided by ${DEFAULT_PLATFORM_NAME}. Insurance provided by licensed insurers and brokers.`;
/** Honest copy about referral credits (shown wherever credits appear). */
export const REFERRAL_CREDIT_NOTE =
  "Credits are not cash and cannot be withdrawn. They come off Covva's own platform fees, or a future premium only where the insurer funds the discount. Referrals never change the quotes or the order you see them in.";

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------
/** A new 8-character base32 referral code (cryptographically random). */
export function referralCode(randomBytes: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += REFERRAL_ALPHABET[(bytes[i] ?? 0) & 31];
  return out;
}

/** Normalise a `?ref=` / `?partner=` value: trims, upper-cases, drops spaces and dashes. Null when not a valid code. */
export function parseReferralParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

export interface ReferralTouch {
  code: string;
  source: ReferralSource;
  /** Epoch milliseconds of the first touch. */
  firstTouchAt: number;
  /** Partner API lead handed off with consent (continue link). */
  leadId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cookie value: `CODE.source.firstTouchSeconds[.leadId]`. */
export function encodeReferralCookie(t: ReferralTouch): string {
  const parts = [t.code, t.source, String(Math.floor(t.firstTouchAt / 1000))];
  if (t.leadId && UUID_RE.test(t.leadId)) parts.push(t.leadId);
  return parts.join(".");
}

/** Parse the cookie; null when malformed or outside the attribution window. */
export function decodeReferralCookie(raw: string | null | undefined, now = Date.now()): ReferralTouch | null {
  if (!raw) return null;
  const [code, source, ts, leadId] = raw.split(".");
  const parsed = parseReferralParam(code);
  if (!parsed || !(REFERRAL_SOURCES as readonly string[]).includes(source ?? "")) return null;
  const firstTouchAt = Number(ts) * 1000;
  if (!Number.isFinite(firstTouchAt) || firstTouchAt <= 0 || !withinAttributionWindow(firstTouchAt, now)) return null;
  return { code: parsed, source: source as ReferralSource, firstTouchAt, leadId: leadId && UUID_RE.test(leadId) ? leadId : null };
}

export function withinAttributionWindow(firstTouchAt: number | string | Date, now: number | Date = Date.now()): boolean {
  const t = new Date(firstTouchAt).getTime();
  const n = new Date(now).getTime();
  return t <= n + 60_000 && n - t <= attributionWindowDays * 86_400_000;
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------
export type RewardKind = "referral_credit" | "referral_bonus" | "partner_revenue_share";
export type LinkOwnerKind = "customer" | "distributor" | "broker";

export interface RewardConditions {
  min_premium?: number;
  categories?: string[];
  first_policy_only?: boolean;
  holding_days?: number;
  /** Customer referral: credit for the referred friend (the referrer gets `amount`). */
  friend_amount?: number;
  owner_kinds?: LinkOwnerKind[];
  expiry_days?: number;
}

export interface RewardRule {
  key: string;
  kind: RewardKind;
  amount: number;
  conditions: RewardConditions;
  active: boolean;
  insurerOrgId?: string | null;
}

export interface RewardPolicy {
  status: string;
  premium: number | null;
  categorySlug: string | null;
  insurerOrgId: string | null;
  /** When cover became active (issued_at, else cover_start). */
  activatedAt: string | Date | null;
  /** True when this is the customer's first policy bought through Covva. */
  isFirstPolicy: boolean;
}

export interface RewardAttribution {
  ownerKind: LinkOwnerKind;
  convertedAt: string | Date | null;
  /** distribution_partners.revenue_share_pct (partner rules). */
  revenueSharePct?: number | null;
  /** Net platform fee Covva earned on the policy (ledger `platform_fee` less reversals). */
  platformFee?: number | null;
}

export interface RewardEntry {
  recipient: "referrer" | "friend" | "partner";
  kind: RewardKind;
  amount: number;
}

export type RewardDecision =
  | { status: "eligible"; entries: RewardEntry[]; expiresAt: Date | null }
  | { status: "pending"; until: Date; reason: string }
  | { status: "ineligible"; reason: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function normaliseRewardConditions(raw: unknown): RewardConditions {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  return {
    min_premium: num(c.min_premium),
    categories: strs(c.categories),
    first_policy_only: typeof c.first_policy_only === "boolean" ? c.first_policy_only : undefined,
    holding_days: num(c.holding_days),
    friend_amount: num(c.friend_amount),
    owner_kinds: strs(c.owner_kinds) as LinkOwnerKind[] | undefined,
    expiry_days: num(c.expiry_days),
  };
}

/**
 * Decide one rule for one converted attribution. `pending` means "ask again after `until`"
 * (holding period still running); `ineligible` is final.
 */
export function rewardFor(rule: RewardRule, policy: RewardPolicy, attribution: RewardAttribution, now: Date = new Date()): RewardDecision {
  const c = rule.conditions ?? {};
  if (!rule.active) return { status: "ineligible", reason: "Rule is not active" };
  if (c.owner_kinds?.length && !c.owner_kinds.includes(attribution.ownerKind)) return { status: "ineligible", reason: "Rule does not apply to this kind of link" };
  if (rule.kind === "partner_revenue_share" && attribution.ownerKind === "customer") return { status: "ineligible", reason: "Customer links earn credits, not revenue share" };
  if (rule.kind !== "partner_revenue_share" && attribution.ownerKind !== "customer") return { status: "ineligible", reason: "Partner links earn revenue share, not customer credits" };
  if (!attribution.convertedAt) return { status: "ineligible", reason: "Not converted" };
  if (rule.insurerOrgId && rule.insurerOrgId !== policy.insurerOrgId) return { status: "ineligible", reason: "Rule is for another insurer" };
  if (c.categories?.length && (!policy.categorySlug || !c.categories.includes(policy.categorySlug))) return { status: "ineligible", reason: "Category not covered by the rule" };
  if (c.min_premium != null && (policy.premium ?? 0) < c.min_premium) return { status: "ineligible", reason: `Premium below GHS ${c.min_premium}` };
  if (c.first_policy_only && !policy.isFirstPolicy) return { status: "ineligible", reason: "Only the customer's first policy qualifies" };

  const holdingDays = c.holding_days ?? DEFAULT_HOLDING_DAYS;
  const start = new Date(policy.activatedAt ?? attribution.convertedAt);
  const until = new Date(start.getTime() + holdingDays * 86_400_000);
  // Cancelled / declined cover never qualifies; anything else must still be active after the holding period.
  if (["cancelled", "declined", "lapsed", "void"].includes(policy.status)) return { status: "ineligible", reason: `Policy ${policy.status}` };
  if (now < until) return { status: "pending", until, reason: `Holding period (${holdingDays} days) runs until ${until.toISOString().slice(0, 10)}` };
  if (policy.status !== "active" && policy.status !== "renewed" && policy.status !== "expired") return { status: "ineligible", reason: `Policy ${policy.status}` };

  const expiresAt = c.expiry_days ? new Date(now.getTime() + c.expiry_days * 86_400_000) : null;
  if (rule.kind === "partner_revenue_share") {
    const amount = partnerRevenueShare(attribution.platformFee ?? 0, attribution.revenueSharePct ?? 0);
    if (amount <= 0) return { status: "ineligible", reason: "No platform fee (or no revenue share agreed) on this policy" };
    return { status: "eligible", entries: [{ recipient: "partner", kind: "partner_revenue_share", amount }], expiresAt: null };
  }
  const entries: RewardEntry[] = [];
  if (rule.amount > 0) entries.push({ recipient: "referrer", kind: rule.kind, amount: round2(rule.amount) });
  if ((c.friend_amount ?? 0) > 0) entries.push({ recipient: "friend", kind: "referral_bonus", amount: round2(c.friend_amount!) });
  if (!entries.length) return { status: "ineligible", reason: "Rule has no amount" };
  return { status: "eligible", entries, expiresAt };
}

/** Partner revenue share: `pct` % of COVVA'S PLATFORM FEE (never the premium), rounded to the pesewa. */
export function partnerRevenueShare(platformFee: number, pct: number): number {
  const fee = Number.isFinite(platformFee) ? Math.max(0, platformFee) : 0;
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return round2((fee * p) / 100);
}

export interface RewardLedgerLine { kind: string; amount: number; expires_at?: string | null }

/** Spendable credit balance: unexpired credits plus redemptions/reversals/adjustments, never below zero. */
export function creditBalance(lines: RewardLedgerLine[], now: Date = new Date()): number {
  let total = 0;
  for (const l of lines) {
    const amount = Number(l.amount) || 0;
    if (amount > 0 && l.kind !== "adjustment" && l.expires_at && new Date(l.expires_at) < now) continue;
    total += amount;
  }
  return Math.max(0, round2(total));
}

// ---------------------------------------------------------------------------
// Partner branding and embedding
// ---------------------------------------------------------------------------
/** WCAG 2.x contrast ratio of `hex` (#rrggbb or #rgb) against `against` (default white). Null when invalid. */
export function contrastRatio(hex: string, against = "#ffffff"): number | null {
  const lum = (h: string): number | null => {
    let s = h.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((x) => x + x).join("");
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    const ch = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const a = lum(hex);
  const b = lum(against);
  if (a == null || b == null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** True when white text on `hex` (and `hex` text on white) meets WCAG AA for normal text (4.5:1). */
export function contrastOk(hex: string, min = 4.5): boolean {
  const r = contrastRatio(hex);
  return r != null && r >= min;
}

const ORIGIN_RE = /^https:\/\/(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?$/;

/** Normalise one allowed embedding origin (`https://shop.example.com`, `https://*.bank.example`). Null when invalid. */
export function normaliseWidgetDomain(value: string): string | null {
  let v = value.trim().toLowerCase().replace(/\/+$/, "");
  if (!v) return null;
  if (!/^[a-z]+:\/\//.test(v)) v = `https://${v}`;
  if (/^http:\/\/localhost(:\d{2,5})?$/.test(v)) return v;
  return ORIGIN_RE.test(v) ? v : null;
}

/** CSP `frame-ancestors` directive for a partner (`'none'` when nothing is allowed). */
export function frameAncestors(domains: readonly string[] | null | undefined): string {
  const list = (domains ?? []).map(normaliseWidgetDomain).filter((d): d is string => !!d);
  return `frame-ancestors ${list.length ? list.join(" ") : "'none'"}`;
}

/** Copy-paste snippet for a partner's website. */
export function widgetSnippet(code: string, category: string | null = "motor", siteUrl = "https://covva.com.gh"): string {
  const base = siteUrl.replace(/\/$/, "");
  return `<script src="${base}/embed/widget.js" data-partner="${code}"${category ? ` data-category="${category}"` : ""} async></script>`;
}

/** Shareable link for a code (`landingPath` is always relative). */
export function referralUrl(code: string, landingPath = "/", siteUrl = "https://covva.com.gh"): string {
  const path = landingPath.startsWith("/") && !landingPath.startsWith("//") ? landingPath : "/";
  const url = new URL(path, siteUrl.replace(/\/$/, "") + "/");
  url.searchParams.set("ref", code);
  return url.toString();
}

/** First name only (partner reports never show more). */
export function firstNameOnly(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().split(/\s+/)[0];
  return n ? n : null;
}

/** `+233*******67` — matches private.mask_phone in the database. */
export function maskPhone(phone: string | null | undefined): string | null {
  const p = (phone ?? "").replace(/\s/g, "");
  if (p.length < 6) return null;
  return `${p.slice(0, 4)}${"*".repeat(Math.max(p.length - 6, 2))}${p.slice(-2)}`;
}
