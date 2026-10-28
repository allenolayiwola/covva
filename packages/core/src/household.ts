/**
 * Household cover view (Roadmap Phase 1 "Family/household view", ties into the diaspora model).
 *
 * The family dashboard (`familyDashboardSummary`) is the sponsor's view: what they pay for. This is the
 * household's view, for anyone — a customer in Ghana as much as a sponsor abroad: every policy the
 * person may already see (their own, the ones they pay for, the ones a relative pays for them), grouped
 * by the person it covers, with who pays, what renews when and who has no cover. Pure and deterministic;
 * the server only loads rows the caller's RLS allows, so this never widens access.
 */

export interface HouseholdPolicyInput {
  id: string;
  status: string;
  cover_end?: string | null;
  cover_start?: string | null;
  premium?: number | string | null;
  currency?: string | null;
  billing_period?: string | null;
  customer_id?: string | null;
  sponsor_user_id?: string | null;
  beneficiary_id?: string | null;
  nickname?: string | null;
  summary?: string | null;
  policy_number?: string | null;
  category_name?: string | null;
  category_slug?: string | null;
  insurer_name?: string | null;
  gift?: boolean | null;
}

export interface HouseholdMemberInput {
  id: string;
  full_name: string;
  relationship?: string | null;
  consent_status?: string | null;
  /** Covva account linked to this beneficiary record, when they have one. */
  linked_user_id?: string | null;
}

export interface HouseholdViewInput {
  userId: string;
  /** Shown as the first person ("You"); the name is used in the next-renewal line. */
  userName?: string | null;
  /** Beneficiaries the user registered (their own household). */
  beneficiaries: HouseholdMemberInput[];
  /** Beneficiary records about the user themselves, registered by a sponsor (linked_user_id = user). */
  myBeneficiaryIds?: string[];
  policies: HouseholdPolicyInput[];
  /** policy id → the sponsor's first name, for policies someone else pays for (null = unknown). */
  sponsorNames?: Record<string, string | null | undefined>;
  now?: Date;
}

export type HouseholdRole = "you" | "member" | "other";
export type Payer = "you" | "sponsor" | "them";
export type CoverState = "covered" | "expiring" | "pending" | "lapsed" | "none";

export interface HouseholdPolicyView {
  id: string;
  title: string;
  status: string;
  coverEnd: string | null;
  daysLeft: number | null;
  premium: number | null;
  currency: string | null;
  billingPeriod: string | null;
  insurerName: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  policyNumber: string | null;
  payer: Payer;
  /** "You pay" / "Paid for by Kofi" / "A gift from Kofi" / "Paid by Ama". */
  payerLabel: string;
}

export interface HouseholdPerson {
  key: string;
  name: string;
  relationship: string | null;
  role: HouseholdRole;
  consentStatus: string | null;
  beneficiaryId: string | null;
  policies: HouseholdPolicyView[];
  coverState: CoverState;
  /** Plain-language next step for a person without live cover (null when covered). */
  nextStep: string | null;
}

export interface HouseholdSummary {
  people: number;
  covered: number;
  withoutCover: number;
  activePolicies: number;
  pendingPolicies: number;
  expiringSoon: number;
  nextRenewal: { policyId: string; personName: string; coverEnd: string; days: number } | null;
  /** GHS premiums per year across active policies in the household (foreign-currency policies excluded). */
  annualPremiumGHS: number;
  /** Policies someone else pays for the user (the "looked after" line). */
  sponsoredForYou: number;
}

export interface HouseholdView {
  people: HouseholdPerson[];
  summary: HouseholdSummary;
}

/** Days from today's date (UTC) to an ISO date, whole days; the same rule the family dashboard uses. */
export function daysFromDate(now: Date, iso: string): number {
  const end = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

export const EXPIRING_SOON_DAYS = 30;
const LIVE_STATUSES = ["active", "pending_issuance"] as const;

export function policyTitle(p: Pick<HouseholdPolicyInput, "nickname" | "summary" | "category_name">): string {
  return p.nickname || p.summary || p.category_name || "Policy";
}

function firstName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n ? n.split(/\s+/)[0]! : null;
}

/** Who pays for a policy from the viewer's point of view. */
export function payerFor(p: HouseholdPolicyInput, userId: string, sponsorFirstName: string | null | undefined, coveredName: string | null | undefined): { payer: Payer; label: string } {
  if (p.sponsor_user_id && p.sponsor_user_id !== userId) {
    const who = sponsorFirstName || "a family member";
    return { payer: "sponsor", label: p.gift ? `A gift from ${who}` : `Paid for by ${who}` };
  }
  if (p.sponsor_user_id === userId || p.customer_id === userId || (!p.sponsor_user_id && !p.customer_id)) return { payer: "you", label: "You pay" };
  return { payer: "them", label: coveredName ? `Paid by ${firstName(coveredName)}` : "Paid by them" };
}

export function coverStateFor(policies: Pick<HouseholdPolicyView, "status" | "daysLeft">[]): CoverState {
  const active = policies.filter((p) => p.status === "active" && (p.daysLeft === null || p.daysLeft >= 0));
  if (active.length) return active.some((p) => p.daysLeft !== null && p.daysLeft > EXPIRING_SOON_DAYS) || active.some((p) => p.daysLeft === null) ? "covered" : "expiring";
  if (policies.some((p) => p.status === "pending_issuance")) return "pending";
  if (policies.length) return "lapsed";
  return "none";
}

function nextStepFor(person: Pick<HouseholdPerson, "role" | "consentStatus" | "coverState" | "name">): string | null {
  const first = firstName(person.name) ?? person.name;
  if (person.role === "member") {
    if (person.consentStatus === "declined") return `${first} declined. Talk to them, then ask again.`;
    if (person.consentStatus !== "granted") return `${first} hasn't consented yet — send them a code.`;
  }
  switch (person.coverState) {
    case "none":
      return person.role === "you" ? "You have no cover yet. Get a quote to see prices from licensed insurers." : `${first} has no live cover. Get a quote for them.`;
    case "lapsed":
      return person.role === "you" ? "Your cover has ended. Renew or get a fresh quote." : `${first}'s cover has ended. Renew it or get a fresh quote.`;
    case "expiring":
      return person.role === "you" ? "Your cover ends soon. Review the renewal." : `${first}'s cover ends soon. Review the renewal.`;
    default:
      return null;
  }
}

/**
 * Groups the household's policies by the person they cover. Order: you, then members by name (consent
 * pending last), then "someone else in your household" for policies that match nobody listed.
 */
export function buildHouseholdView(input: HouseholdViewInput): HouseholdView {
  const now = input.now ?? new Date();
  const myBeneficiaries = new Set(input.myBeneficiaryIds ?? []);
  const members = new Map(input.beneficiaries.map((b) => [b.id, b]));
  const people = new Map<string, HouseholdPerson>();
  const person = (key: string, make: () => Omit<HouseholdPerson, "policies" | "coverState" | "nextStep">): HouseholdPerson => {
    let p = people.get(key);
    if (!p) {
      p = { ...make(), policies: [], coverState: "none", nextStep: null };
      people.set(key, p);
    }
    return p;
  };

  person("you", () => ({ key: "you", name: input.userName?.trim() || "You", relationship: null, role: "you", consentStatus: null, beneficiaryId: null }));
  for (const b of input.beneficiaries) {
    if (b.linked_user_id === input.userId) continue; // a record about the viewer themselves
    person(`member:${b.id}`, () => ({ key: `member:${b.id}`, name: b.full_name, relationship: b.relationship ?? null, role: "member", consentStatus: b.consent_status ?? null, beneficiaryId: b.id }));
  }

  let sponsoredForYou = 0;
  for (const p of input.policies) {
    const member = p.beneficiary_id ? members.get(p.beneficiary_id) : undefined;
    const isYou = !member && (p.customer_id === input.userId || (p.beneficiary_id ? myBeneficiaries.has(p.beneficiary_id) : false) || (!p.beneficiary_id && p.sponsor_user_id === input.userId));
    const target = member && member.linked_user_id !== input.userId
      ? person(`member:${member.id}`, () => ({ key: `member:${member.id}`, name: member.full_name, relationship: member.relationship ?? null, role: "member", consentStatus: member.consent_status ?? null, beneficiaryId: member.id }))
      : isYou || (member && member.linked_user_id === input.userId)
        ? person("you", () => ({ key: "you", name: input.userName?.trim() || "You", relationship: null, role: "you", consentStatus: null, beneficiaryId: null }))
        : person("other", () => ({ key: "other", name: "Someone else in your household", relationship: null, role: "other", consentStatus: null, beneficiaryId: null }));
    const payer = payerFor(p, input.userId, input.sponsorNames?.[p.id], target.role === "member" ? target.name : null);
    if (target.role === "you" && payer.payer === "sponsor" && (LIVE_STATUSES as readonly string[]).includes(p.status)) sponsoredForYou++;
    const premium = p.premium == null || p.premium === "" ? null : Number(p.premium);
    target.policies.push({
      id: p.id,
      title: policyTitle(p),
      status: p.status,
      coverEnd: p.cover_end ? p.cover_end.slice(0, 10) : null,
      daysLeft: p.cover_end ? daysFromDate(now, p.cover_end) : null,
      premium: premium !== null && Number.isFinite(premium) ? premium : null,
      currency: p.currency ?? null,
      billingPeriod: p.billing_period ?? null,
      insurerName: p.insurer_name ?? null,
      categoryName: p.category_name ?? null,
      categorySlug: p.category_slug ?? null,
      policyNumber: p.policy_number ?? null,
      payer: payer.payer,
      payerLabel: payer.label,
    });
  }

  const statusRank = (s: string) => (s === "active" ? 0 : s === "pending_issuance" ? 1 : 2);
  for (const p of people.values()) {
    p.policies.sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9) || a.title.localeCompare(b.title));
    p.coverState = coverStateFor(p.policies);
    p.nextStep = nextStepFor(p);
  }
  const ordered = [...people.values()].sort((a, b) => {
    const rank = (x: HouseholdPerson) => (x.role === "you" ? 0 : x.role === "member" ? (x.consentStatus === "granted" ? 1 : 2) : 3);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  const all = ordered.flatMap((p) => p.policies.map((pol) => ({ ...pol, personName: p.name })));
  const active = all.filter((p) => p.status === "active");
  const nextRenewal = active
    .filter((p) => p.coverEnd && p.daysLeft !== null && p.daysLeft >= 0)
    .sort((a, b) => a.daysLeft! - b.daysLeft!)
    .map((p) => ({ policyId: p.id, personName: p.personName, coverEnd: p.coverEnd!, days: p.daysLeft! }))[0] ?? null;
  const annualPremiumGHS = active.reduce((sum, p) => {
    if (p.currency && p.currency !== "GHS") return sum;
    if (p.premium === null) return sum;
    const factor = p.billingPeriod === "month" ? 12 : p.billingPeriod === "quarter" ? 4 : p.billingPeriod === "week" ? 52 : p.billingPeriod === "day" ? 365 : 1;
    return sum + p.premium * factor;
  }, 0);
  const counted = ordered.filter((p) => p.role !== "other");
  return {
    people: ordered,
    summary: {
      people: counted.length,
      covered: counted.filter((p) => p.coverState === "covered" || p.coverState === "expiring").length,
      withoutCover: counted.filter((p) => p.coverState === "none" || p.coverState === "lapsed").length,
      activePolicies: active.length,
      pendingPolicies: all.filter((p) => p.status === "pending_issuance").length,
      expiringSoon: active.filter((p) => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= EXPIRING_SOON_DAYS).length,
      nextRenewal,
      annualPremiumGHS: Math.round(annualPremiumGHS * 100) / 100,
      sponsoredForYou,
    },
  };
}
