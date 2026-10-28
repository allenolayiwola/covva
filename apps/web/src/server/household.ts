import "server-only";
import { buildHouseholdView, type HouseholdPolicyInput, type HouseholdView } from "@im/core";
import type { Row } from "@im/db";
import type { UserClient } from "@/server/api-auth";
import { BENEFICIARY_COLS, listBeneficiaries } from "./diaspora";

type Db = UserClient;

/**
 * Household cover (Roadmap Phase 1 "Family/household view"): every policy the signed-in person may already
 * see, grouped by who it covers — their own, the ones they pay for a family member, and the ones a relative
 * (often abroad) pays for them. Reads go through the caller's RLS client, so this never widens access; the
 * grouping itself is `buildHouseholdView` in @im/core.
 */

const POLICY_COLS = "id, status, cover_start, cover_end, premium, currency, billing_period, customer_id, sponsor_user_id, beneficiary_id, nickname, summary, policy_number, category:product_categories(name, slug), insurer:organizations!policies_insurer_org_id_fkey(name)";

type PolicyRow = Pick<Row<"policies">, "id" | "status" | "cover_start" | "cover_end" | "premium" | "currency" | "billing_period" | "customer_id" | "sponsor_user_id" | "beneficiary_id" | "nickname" | "summary" | "policy_number"> & {
  category: { name: string; slug: string } | null;
  insurer: { name: string } | null;
};

export interface HouseholdCover extends HouseholdView {
  /** Beneficiary ids the household page links to (members the user registered). */
  memberIds: string[];
}

export async function householdCover(db: Db, userId: string, userName?: string | null): Promise<HouseholdCover> {
  const beneficiaries = await listBeneficiaries(db, userId);
  const mineRes = await db.from("beneficiaries").select(BENEFICIARY_COLS).eq("linked_user_id", userId);
  const myBeneficiaryIds = (mineRes.data ?? []).map((b) => b.id);
  const covered = [...new Set([...beneficiaries.map((b) => b.id), ...myBeneficiaryIds])];
  const filters = [`customer_id.eq.${userId}`, `sponsor_user_id.eq.${userId}`, ...(covered.length ? [`beneficiary_id.in.(${covered.join(",")})`] : [])];
  const { data } = await db.from("policies").select(POLICY_COLS).or(filters.join(",")).order("cover_end", { ascending: true, nullsFirst: false }).limit(300);
  const policies = (data ?? []) as unknown as PolicyRow[];

  // Who pays for the policies someone else sponsors (first names only, via the consent-aware RPC).
  const sponsored = policies.filter((p) => p.sponsor_user_id && p.sponsor_user_id !== userId).slice(0, 20);
  const sponsorNames: Record<string, string | null> = {};
  const gifts = new Set<string>();
  if (sponsored.length) {
    const [names, sponsorshipsRes] = await Promise.all([
      Promise.all(sponsored.map(async (p) => [p.id, (await db.rpc("policy_sponsor_name", { p_policy_id: p.id })).data ?? null] as const)),
      db.from("sponsorships").select("policy_id, gift").in("policy_id", sponsored.map((p) => p.id)),
    ]);
    for (const [id, name] of names) sponsorNames[id] = name;
    for (const s of sponsorshipsRes.data ?? []) if (s.gift && s.policy_id) gifts.add(s.policy_id);
  }

  const input: HouseholdPolicyInput[] = policies.map((p) => ({
    id: p.id,
    status: p.status,
    cover_start: p.cover_start,
    cover_end: p.cover_end,
    premium: p.premium,
    currency: p.currency,
    billing_period: p.billing_period,
    customer_id: p.customer_id,
    sponsor_user_id: p.sponsor_user_id,
    beneficiary_id: p.beneficiary_id,
    nickname: p.nickname,
    summary: p.summary,
    policy_number: p.policy_number,
    category_name: p.category?.name ?? null,
    category_slug: p.category?.slug ?? null,
    insurer_name: p.insurer?.name ?? null,
    gift: gifts.has(p.id),
  }));
  const view = buildHouseholdView({
    userId,
    userName,
    beneficiaries: beneficiaries.map((b) => ({ id: b.id, full_name: b.full_name, relationship: b.relationship, consent_status: b.consent_status, linked_user_id: b.linked_user_id })),
    myBeneficiaryIds,
    policies: input,
    sponsorNames,
  });
  return { ...view, memberIds: beneficiaries.map((b) => b.id) };
}
