import { z } from "zod";
import { normalisePhone } from "./onboarding";

/**
 * Diaspora core (build prompt "DIASPORA", Roadmap Phase 2): sponsor countries and currencies,
 * beneficiary validation, consent codes, proxy-claim rules and the family dashboard summary.
 * Shared by the web app, the mobile app and the API contracts.
 */

// ---------------------------------------------------------------------------
// Countries and currencies
// ---------------------------------------------------------------------------
export interface SponsorCountry {
  code: string;
  name: string;
  currency: string;
  /** Default IANA time zone for reminders. */
  timezone: string;
}

/** Where diaspora sponsors live. Ghana is the home country (not a sponsor country). */
export const SPONSOR_COUNTRIES: readonly SponsorCountry[] = [
  { code: "GB", name: "United Kingdom", currency: "GBP", timezone: "Europe/London" },
  { code: "US", name: "United States", currency: "USD", timezone: "America/New_York" },
  { code: "CA", name: "Canada", currency: "CAD", timezone: "America/Toronto" },
  { code: "DE", name: "Germany", currency: "EUR", timezone: "Europe/Berlin" },
  { code: "NL", name: "Netherlands", currency: "EUR", timezone: "Europe/Amsterdam" },
  { code: "IT", name: "Italy", currency: "EUR", timezone: "Europe/Rome" },
  { code: "FR", name: "France", currency: "EUR", timezone: "Europe/Paris" },
  { code: "IE", name: "Ireland", currency: "EUR", timezone: "Europe/Dublin" },
  { code: "AU", name: "Australia", currency: "AUD", timezone: "Australia/Sydney" },
] as const;

export const HOME_COUNTRY: SponsorCountry = { code: "GH", name: "Ghana", currency: "GHS", timezone: "Africa/Accra" };

/** Sign-up / profile country picker: Ghana first, then the sponsor countries. */
export const COUNTRY_OPTIONS: readonly SponsorCountry[] = [HOME_COUNTRY, ...SPONSOR_COUNTRIES];

/** Currencies a sponsor can choose to see prices in. Premiums always settle in GHS. */
export const SPONSOR_CURRENCIES = ["GHS", "GBP", "USD", "EUR", "CAD", "AUD"] as const;
export type SponsorCurrency = (typeof SPONSOR_CURRENCIES)[number];

export function countryByCode(code: string | null | undefined): SponsorCountry | null {
  const c = (code ?? "").trim().toUpperCase();
  return COUNTRY_OPTIONS.find((x) => x.code === c) ?? null;
}

/** A sponsor is anyone whose country of residence is not Ghana. */
export function isSponsorCountry(code: string | null | undefined): boolean {
  const c = (code ?? "GH").trim().toUpperCase();
  return c !== "GH" && c.length === 2;
}

/** The currency a country's residents usually pay in (GHS for Ghana and unknown countries). */
export function currencyForCountry(code: string | null | undefined): SponsorCurrency {
  const c = countryByCode(code);
  const cur = c?.currency ?? "GHS";
  return (SPONSOR_CURRENCIES as readonly string[]).includes(cur) ? (cur as SponsorCurrency) : "GHS";
}

export function timezoneForCountry(code: string | null | undefined): string {
  return countryByCode(code)?.timezone ?? HOME_COUNTRY.timezone;
}

// ---------------------------------------------------------------------------
// Beneficiaries
// ---------------------------------------------------------------------------
export const RELATIONSHIPS = [
  { value: "parent", label: "Parent", plural: "Parents" },
  { value: "spouse", label: "Spouse", plural: "Spouse" },
  { value: "child", label: "Child", plural: "Children" },
  { value: "sibling", label: "Sibling", plural: "Siblings" },
  { value: "other", label: "Other relative", plural: "Other relatives" },
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number]["value"];
export const RELATIONSHIP_VALUES = RELATIONSHIPS.map((r) => r.value) as [Relationship, ...Relationship[]];

export function relationshipLabel(value: string | null | undefined): string {
  return RELATIONSHIPS.find((r) => r.value === value)?.label ?? "Relative";
}

/** Ghana numbers only — the consent code goes to a Ghanaian phone. Returns E.164 (+233XXXXXXXXX) or null. */
export function normaliseBeneficiaryPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const n = normalisePhone(input.trim());
  return /^\+233\d{9}$/.test(n) ? n : null;
}

const GHANA_CARD_RE = /^GHA-?\d{9}-?\d$/i;

export function normaliseGhanaCardNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toUpperCase().replace(/\s+/g, "");
  const m = /^GHA-?(\d{9})-?(\d)$/.exec(s);
  return m ? `GHA-${m[1]}-${m[2]}` : null;
}

/** Ghana Card shown in any UI: GHA-•••••6789-0. */
export function maskGhanaCard(value: string | null | undefined): string | null {
  if (!value) return null;
  const n = normaliseGhanaCardNumber(value) ?? value;
  const m = /^GHA-(\d{9})-(\d)$/.exec(n);
  if (!m) return `••••${n.slice(-4)}`;
  return `GHA-•••••${m[1]!.slice(5)}-${m[2]}`;
}

const phoneField = z
  .string()
  .trim()
  .min(1, "Enter their mobile number")
  .transform((v, ctx) => {
    const p = normaliseBeneficiaryPhone(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "Enter a Ghana mobile number, e.g. 024 123 4567" });
      return z.NEVER;
    }
    return p;
  });

const ghanaCardField = z
  .string()
  .trim()
  .max(20)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!GHANA_CARD_RE.test(v.replace(/\s+/g, ""))) {
      ctx.addIssue({ code: "custom", message: "Use the format GHA-123456789-0" });
      return z.NEVER;
    }
    return normaliseGhanaCardNumber(v);
  });

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** A family member in Ghana the sponsor adds. Phone is normalised to E.164; the Ghana Card is optional. */
export const beneficiarySchema = z.object({
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  relationship: z.enum(RELATIONSHIP_VALUES, { error: "Choose how they are related to you" }),
  phone: phoneField,
  email: z.preprocess(emptyToUndefined, z.string().trim().email("Enter a valid email address").max(200).optional()),
  dateOfBirth: z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").optional()),
  ghanaCardNumber: z.preprocess(emptyToUndefined, ghanaCardField),
  address: z.preprocess(emptyToUndefined, z.string().trim().max(300).optional()),
  region: z.preprocess(emptyToUndefined, z.string().trim().max(60).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
});
export type BeneficiaryInput = z.infer<typeof beneficiarySchema>;

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------
export const CONSENT_KINDS = ["data_sharing", "proxy_claims", "policy_purchase"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const CONSENT_KIND_META: Record<ConsentKind, { title: string; summary: string; shares: string[] }> = {
  data_sharing: {
    title: "Share my details so cover can be arranged for me",
    summary: "Your relative abroad wants to pay for insurance that covers you. Your name, phone number and the details needed for the policy will be shared with a licensed broker and the insurer.",
    shares: ["Your name, phone number and date of birth", "Ghana Card number if the insurer needs it", "Policy documents, renewal reminders and claim updates sent to you too"],
  },
  proxy_claims: {
    title: "Let my sponsor start and follow claims for me",
    summary: "Your sponsor can report a claim on a policy they pay for and see its progress. The insurer still decides the claim and pays as the policy says.",
    shares: ["Claim details and documents your sponsor uploads on your behalf", "Claim status updates sent to both of you"],
  },
  policy_purchase: {
    title: "Let my sponsor buy cover in my name",
    summary: "Your sponsor can apply for and pay for policies where you are the policyholder or the life insured.",
    shares: ["Applications and declarations made on your behalf", "Policy documents in your name"],
  },
};

export const CONSENT_STATUS: Record<"pending" | "granted" | "declined" | "expired", { label: string; tone: "neutral" | "ok" | "danger" | "info" | "wait"; hint: string }> = {
  pending: { label: "Awaiting consent", tone: "wait", hint: "Send a code by SMS or WhatsApp. They read it out to you, or tap the link to accept." },
  granted: { label: "Consent given", tone: "ok", hint: "They agreed to have cover arranged for them." },
  declined: { label: "Declined", tone: "danger", hint: "They declined. You can ask again after talking to them." },
  expired: { label: "Code expired", tone: "wait", hint: "The code was not used within 15 minutes. Send a new one." },
};

export const CONSENT_CODE_TTL_MINUTES = 15;
export const CONSENT_MAX_ATTEMPTS = 5;

/** A 6-digit consent code from a cryptographic source (the database generates its own; this one is for links/tests). */
export function consentCode(): string {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

/** The text sent to the beneficiary with the code (SMS/WhatsApp). Kept short for a single SMS segment. */
export function consentMessage(args: { sponsorName: string; beneficiaryName?: string | null; kind: ConsentKind; code: string; link?: string | null }): string {
  const what =
    args.kind === "proxy_claims" ? "handle insurance claims for you" : args.kind === "policy_purchase" ? "buy insurance in your name" : "arrange insurance cover for you";
  const hi = args.beneficiaryName ? `Hi ${args.beneficiaryName.split(/\s+/)[0]}, ` : "";
  const link = args.link ? ` Or tap to accept: ${args.link}` : "";
  return `${hi}${args.sponsorName} wants to ${what} through Covva. Your consent code is ${args.code} (valid ${CONSENT_CODE_TTL_MINUTES} min). Read it to ${args.sponsorName} to agree.${link}`;
}

export interface ConsentRecord {
  kind: string;
  granted: boolean;
  expires_at?: string | null;
  granted_at?: string | null;
  declined_at?: string | null;
}

export function consentGranted(consents: ConsentRecord[] | null | undefined, kind: ConsentKind, now = new Date()): boolean {
  const c = (consents ?? []).find((x) => x.kind === kind);
  if (!c || !c.granted) return false;
  // Granted consents have no expiry (expires_at is only for pending codes), but honour one if set.
  if (c.expires_at && !c.granted_at && new Date(c.expires_at) < now) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sponsorships, gifts, proxy claims
// ---------------------------------------------------------------------------
export const giftMessageSchema = z.object({
  gift: z.boolean().default(false),
  giftMessage: z.preprocess(emptyToUndefined, z.string().trim().max(500, "Keep the message under 500 characters").optional()),
  notifyBeneficiary: z.boolean().default(true),
});
export type GiftInput = z.infer<typeof giftMessageSchema>;

export interface SponsorshipLike {
  status: "draft" | "active" | "ended" | string;
  policy_id?: string | null;
  sponsor_user_id?: string;
}

export type ProxyClaimCheck = { ok: true } | { ok: false; reason: "no_sponsorship" | "not_active" | "no_data_consent" | "no_proxy_consent"; message: string };

/**
 * Claims by proxy (build prompt): the sponsor may start or follow a claim on behalf of a beneficiary
 * only with the beneficiary's consent. Needs an active sponsorship, data-sharing consent and the
 * specific proxy_claims consent.
 */
export function canFileProxyClaim(sponsorship: SponsorshipLike | null | undefined, consents: ConsentRecord[] | null | undefined, now = new Date()): ProxyClaimCheck {
  if (!sponsorship) return { ok: false, reason: "no_sponsorship", message: "You can only claim on a policy you pay for through a sponsorship." };
  if (sponsorship.status !== "active" || !sponsorship.policy_id) return { ok: false, reason: "not_active", message: "This sponsorship isn't active yet — the policy has to be issued first." };
  if (!consentGranted(consents, "data_sharing", now)) return { ok: false, reason: "no_data_consent", message: "Your family member hasn't given consent to share their details yet." };
  if (!consentGranted(consents, "proxy_claims", now)) return { ok: false, reason: "no_proxy_consent", message: "Ask your family member to consent to you handling claims for them (a quick SMS code)." };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Family dashboard summary
// ---------------------------------------------------------------------------
export interface DashboardPolicy {
  id: string;
  status: string;
  cover_end?: string | null;
  premium?: number | string | null;
  currency?: string | null;
  billing_period?: string | null;
  beneficiary_id?: string | null;
  category_slug?: string | null;
}
export interface DashboardClaim {
  id: string;
  status: string;
  policy_id?: string | null;
}
export interface DashboardPayment {
  id: string;
  status: string;
  amount?: number | string | null;
  currency?: string | null;
  policy_id?: string | null;
  /** When the next instalment / renewal premium is due (sponsor subscriptions) — ISO date. */
  due_at?: string | null;
  paid_at?: string | null;
}
export interface DashboardBeneficiary {
  id: string;
  full_name: string;
  consent_status: string;
}

export const OPEN_CLAIM_STATUSES = ["draft", "reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"] as const;

export interface FamilyDashboardSummary {
  activePolicies: number;
  pendingPolicies: number;
  nextRenewal: { policyId: string; coverEnd: string; days: number } | null;
  nextPaymentDue: { paymentId: string; dueAt: string; amount: number | null; currency: string | null } | null;
  openClaims: number;
  /** Premiums (GHS) per year across active policies, for the "what you pay" tile. */
  annualPremiumGHS: number;
  /** Beneficiaries with no live cover, or whose consent is still pending — what to do next. */
  coverGaps: { beneficiaryId: string; name: string; reason: "no_cover" | "consent_pending" | "consent_declined" }[];
}

function daysFrom(now: Date, iso: string): number {
  const end = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

export function familyDashboardSummary(
  policies: DashboardPolicy[],
  claims: DashboardClaim[],
  payments: DashboardPayment[],
  beneficiaries: DashboardBeneficiary[] = [],
  now = new Date(),
): FamilyDashboardSummary {
  const active = policies.filter((p) => p.status === "active");
  const pending = policies.filter((p) => p.status === "pending_issuance");
  const renewal = active
    .filter((p) => p.cover_end && daysFrom(now, p.cover_end) >= 0)
    .map((p) => ({ policyId: p.id, coverEnd: p.cover_end!.slice(0, 10), days: daysFrom(now, p.cover_end!) }))
    .sort((a, b) => a.days - b.days)[0] ?? null;
  const due = payments
    .filter((p) => p.due_at && !p.paid_at && ["pending", "processing", "scheduled"].includes(p.status) && Date.parse(p.due_at) >= now.getTime() - 86_400_000)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0];
  const nextPaymentDue = due ? { paymentId: due.id, dueAt: due.due_at!, amount: due.amount == null ? null : Number(due.amount), currency: due.currency ?? null } : null;
  const openClaims = claims.filter((c) => (OPEN_CLAIM_STATUSES as readonly string[]).includes(c.status)).length;
  const annualPremiumGHS = active.reduce((sum, p) => {
    if (p.currency && p.currency !== "GHS") return sum;
    const prem = Number(p.premium ?? 0);
    if (!Number.isFinite(prem)) return sum;
    const factor = p.billing_period === "month" ? 12 : p.billing_period === "quarter" ? 4 : 1;
    return sum + prem * factor;
  }, 0);
  const covered = new Set(policies.filter((p) => p.status === "active" || p.status === "pending_issuance").map((p) => p.beneficiary_id).filter(Boolean));
  const coverGaps: FamilyDashboardSummary["coverGaps"] = [];
  for (const b of beneficiaries) {
    if (b.consent_status === "declined") coverGaps.push({ beneficiaryId: b.id, name: b.full_name, reason: "consent_declined" });
    else if (b.consent_status !== "granted") coverGaps.push({ beneficiaryId: b.id, name: b.full_name, reason: "consent_pending" });
    else if (!covered.has(b.id)) coverGaps.push({ beneficiaryId: b.id, name: b.full_name, reason: "no_cover" });
  }
  return { activePolicies: active.length, pendingPolicies: pending.length, nextRenewal: renewal, nextPaymentDue, openClaims, annualPremiumGHS: Math.round(annualPremiumGHS * 100) / 100, coverGaps };
}

/** "Paid for by Kofi" / "Gift from Kofi" line for a beneficiary-side policy view. */
export function sponsorLine(sponsorFirstName: string | null | undefined, gift: boolean): string | null {
  if (!sponsorFirstName) return null;
  return gift ? `A gift from ${sponsorFirstName}` : `Paid for by ${sponsorFirstName}`;
}
