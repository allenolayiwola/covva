import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Gift, Shield } from "lucide-react";
import { POLICY_STATUS, formatDate, formatGHS } from "@im/core";
import { Card, Notice, StatusPill, buttonClass } from "@im/ui";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UUID_RE, account } from "../../_lib/data";
import { RevealGift } from "./reveal";

export const metadata: Metadata = { title: "A gift for you" };

/** Beneficiary side: open a policy gifted by a sponsor abroad and read their message. */
export default function GiftPage({ params }: PageProps<"/account/gifts/[sponsorshipId]">) {
  return (
    <div className="max-w-xl">
      <Suspense fallback={<PageSkeleton hero rows={2} />}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: Pick<PageProps<"/account/gifts/[sponsorshipId]">, "params">) {
  const { sponsorshipId } = await params;
  if (!UUID_RE.test(sponsorshipId)) notFound();
  const { user, supabase } = await account(`/account/gifts/${sponsorshipId}`);
  const { data: s } = await supabase.from("sponsorships").select("id, gift, gift_message, gift_revealed_at, policy_id, beneficiary_id, sponsor_user_id").eq("id", sponsorshipId).maybeSingle();
  if (!s || !s.gift) notFound();
  const isSponsor = s.sponsor_user_id === user.id;
  const [{ data: sponsorName }, { data: policy }] = await Promise.all([
    s.policy_id ? supabase.rpc("policy_sponsor_name", { p_policy_id: s.policy_id }) : Promise.resolve({ data: null as string | null }),
    s.policy_id
      ? supabase.from("policies").select("id, nickname, summary, policy_number, internal_reference, status, cover_start, cover_end, premium, billing_period, category:product_categories(name), insurer:organizations!policies_insurer_org_id_fkey(name)").eq("id", s.policy_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const from = sponsorName ?? "Someone who cares about you";
  const cat = (policy?.category as unknown as { name: string } | null)?.name;
  const insurer = (policy?.insurer as unknown as { name: string } | null)?.name;

  return (
    <>
      <div className="relative overflow-hidden rounded-card bg-brand-dark p-6 text-white sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-12 size-64 rounded-full bg-white/8" />
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/75"><Gift aria-hidden className="mr-1 inline size-3.5" /> A gift of cover</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight sm:text-[32px]">{isSponsor ? `Your gift${policy ? ` for ${cat ?? "cover"}` : ""}` : `${from} has arranged ${cat ? cat.toLowerCase() : "insurance"} cover for you`}</h1>
        {policy && (
          <p className="mt-2 text-white/85">
            {[insurer, policy.policy_number ?? policy.internal_reference, policy.cover_end ? `cover to ${formatDate(policy.cover_end)}` : null].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {isSponsor ? (
        <Notice tone="info" className="mt-6" title="This is how it looks to them">
          {s.gift_revealed_at ? `Opened on ${formatDate(s.gift_revealed_at)}.` : "Not opened yet. Hand it over from the family member's page when you're ready."}
          {s.gift_message && <span className="mt-2 block whitespace-pre-line italic text-ink">“{s.gift_message}”</span>}
        </Notice>
      ) : (
        <RevealGift sponsorshipId={s.id} revealed={!!s.gift_revealed_at} message={s.gift_revealed_at ? s.gift_message : null} from={from} />
      )}

      {policy && (
        <Card className="mt-6 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Shield aria-hidden className="size-5 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{policy.nickname || policy.summary || cat || "Policy"}</span>
              <span className="block text-sm text-muted">{policy.premium ? `${formatGHS(Number(policy.premium))} / ${policy.billing_period === "month" ? "mo" : "yr"}, paid by ${from}` : `Paid by ${from}`}</span>
            </span>
            <StatusPill meta={POLICY_STATUS[policy.status]} />
          </div>
          <Link href={`/account/policies/${policy.id}`} className={buttonClass("secondary", "sm", "mt-4")}>View the policy and documents</Link>
        </Card>
      )}
      <p className="mt-6 text-xs text-subtle">The policy is arranged by a licensed broker and issued by a licensed insurer. {from} pays the premium; you are covered and can report claims yourself.</p>
    </>
  );
}
