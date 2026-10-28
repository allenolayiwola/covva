import type { Metadata } from "next";
import { Suspense } from "react";
import { Gift } from "lucide-react";
import { Card, Notice, PageHeader, Pill, StatCard } from "@im/ui";
import { REFERRAL_CREDIT_NOTE, creditBalance, formatDate, formatGHS, normaliseRewardConditions, referralUrl } from "@im/core";
import { ListSkeleton } from "@/components/customer/skeletons";
import { CopyField, ShareButtons } from "@/components/referrals/copy-field";
import { siteUrl } from "@/server/api-auth";
import { account } from "../_lib/data";
import { CreateLinkButton } from "./create-link";

export const metadata: Metadata = { title: "Refer a friend" };

const KIND_LABEL: Record<string, string> = {
  referral_credit: "Referral credit",
  referral_bonus: "Welcome credit",
  redemption: "Used",
  reversal: "Reversed",
  adjustment: "Adjustment",
};

export default function ReferralsPage() {
  return (
    <>
      <PageHeader title="Refer a friend" description="Share Covva with friends and family — in Ghana or abroad. They see exactly the same quotes, in the same order." />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <Referrals />
      </Suspense>
    </>
  );
}

async function Referrals() {
  const { user, supabase } = await account("/account/referrals");
  const [link, friends, credits, rule] = await Promise.all([
    supabase.from("referral_links").select("code, landing_path").eq("owner_user_id", user.id).eq("owner_kind", "customer").is("campaign", null).is("disabled_at", null).maybeSingle(),
    supabase.rpc("my_referrals"),
    supabase.from("reward_ledger").select("id, kind, amount, memo, expires_at, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    // RLS: signed-in users only see ACTIVE rules, so no row = the programme is not switched on.
    supabase.from("reward_rules").select("amount, conditions").eq("key", "customer_referral").maybeSingle(),
  ]);
  const lines = (credits.data ?? []).map((c) => ({ ...c, amount: Number(c.amount) }));
  const balance = creditBalance(lines);
  const friendList = friends.data ?? [];
  const covered = friendList.filter((f) => f.converted_at).length;
  const conditions = rule.data ? normaliseRewardConditions(rule.data.conditions) : null;
  const url = link.data ? referralUrl(link.data.code, link.data.landing_path, siteUrl()) : null;

  return (
    <div className="space-y-6" data-testid="referrals-page">
      {rule.data && conditions ? (
        <Notice tone="ok" icon={<Gift className="size-4" aria-hidden />}>
          When a friend you refer buys their first policy and it stays active for {conditions.holding_days ?? 14} days, you get {formatGHS(Number(rule.data.amount))} in credit and they get {formatGHS(conditions.friend_amount ?? 0)}.
        </Notice>
      ) : (
        <Notice tone="info" icon={<Gift className="size-4" aria-hidden />}>
          Referral rewards aren&apos;t switched on yet: rewards for buying insurance need approval from the National Insurance Commission and the insurers first. You can still share your link — friends who join through it are shown below.
        </Notice>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-ink">Your link</h2>
        {url ? (
          <>
            <CopyField label="Referral link" value={url} />
            <p className="text-sm text-muted">Code <span className="font-mono font-semibold text-ink">{link.data!.code}</span> — friends can also type it at sign-up.</p>
            <ShareButtons url={url} text="I compare insurance from licensed insurers on Covva — have a look:" />
          </>
        ) : (
          <CreateLinkButton />
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Friends joined" value={friendList.length} />
        <StatCard label="Friends covered" value={covered} />
        <StatCard label="Credit balance" value={formatGHS(balance, { decimals: true })} hint="Not cash" />
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-ink">Friends</h2>
        {friendList.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No one has joined through your link yet. For privacy we never show who your friends are — only when they joined and whether their cover is active.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {friendList.map((f, i) => (
              <li key={f.attribution_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>Friend {friendList.length - i} · joined {formatDate(f.joined_at)}</span>
                {f.rewarded ? <Pill tone="ok">Credit earned</Pill> : f.converted_at ? <Pill tone="wait">Cover active · credit pending</Pill> : <Pill>Joined</Pill>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-ink">Credit history</h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No credits yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{KIND_LABEL[l.kind] ?? l.kind}</span>
                  <span className="block text-xs text-muted">{formatDate(l.created_at)}{l.expires_at ? ` · expires ${formatDate(l.expires_at)}` : ""}</span>
                </span>
                <span className="tabular-nums">{formatGHS(l.amount, { decimals: true })}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">{REFERRAL_CREDIT_NOTE}</p>
      </Card>
    </div>
  );
}
