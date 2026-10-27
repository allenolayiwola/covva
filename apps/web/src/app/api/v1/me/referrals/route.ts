import { REFERRAL_CREDIT_NOTE, creditBalance, referralCode, referralUrl } from "@im/core";
import { dbError, siteUrl, withApi, type UserClient } from "@/server/api-auth";

async function summary(supabase: UserClient, userId: string) {
  const [link, friends, credits, rule] = await Promise.all([
    supabase.from("referral_links").select("id, code, landing_path, created_at").eq("owner_user_id", userId).eq("owner_kind", "customer").is("campaign", null).is("disabled_at", null).maybeSingle(),
    supabase.rpc("my_referrals"),
    supabase.from("reward_ledger").select("id, kind, amount, currency, memo, expires_at, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    supabase.from("reward_rules").select("key, amount, conditions").eq("key", "customer_referral").maybeSingle(),
  ]);
  const lines = (credits.data ?? []).map((c) => ({ ...c, amount: Number(c.amount) }));
  return {
    link: link.data ? { ...link.data, url: referralUrl(link.data.code, link.data.landing_path, siteUrl()) } : null,
    friends: friends.data ?? [],
    credits: lines,
    balance: creditBalance(lines),
    currency: "GHS",
    programmeActive: !!rule.data,
    note: REFERRAL_CREDIT_NOTE,
  };
}

/** GET /api/v1/me/referrals — my referral link, friends who joined (anonymous), credits and balance. */
export const GET = withApi(async ({ auth }) => summary(auth.supabase, auth.userId), { auth: "user" });

/** POST /api/v1/me/referrals — create (or return) my personal referral link. */
export const POST = withApi(
  async ({ auth }) => {
    const { error } = await auth.supabase.rpc("ensure_my_referral_link", { p_code: referralCode() });
    if (error) throw dbError(error);
    return summary(auth.supabase, auth.userId);
  },
  { auth: "user" },
);
