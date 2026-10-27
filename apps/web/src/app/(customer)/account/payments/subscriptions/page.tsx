import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CreditCard, RefreshCw } from "lucide-react";
import { formatDate, formatMoney, subscriptionSummary } from "@im/core";
import { Card, EmptyState, Notice, PageHeader, Pill, buttonClass } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { account, policyTitle } from "../../_lib/data";
import { cancelSponsorSubscription, pauseSponsorSubscription, resumeSponsorSubscription } from "./actions";
import { SubscriptionActions } from "./subscription-actions";

export const metadata: Metadata = { title: "Recurring payments" };

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Subscriptions />
    </Suspense>
  );
}

async function Subscriptions() {
  const { user, supabase } = await account("/account/payments/subscriptions");
  const [{ data: subs }, { data: methods }] = await Promise.all([
    supabase.from("sponsor_subscriptions").select("*").eq("sponsor_user_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("payment_methods").select("id, psp, brand, last4, exp_month, exp_year, status").eq("user_id", user.id),
  ]);
  const policyIds = [...new Set((subs ?? []).map((s) => s.policy_id).filter((id): id is string => !!id))];
  const { data: policies } = policyIds.length ? await supabase.from("policies").select("id, nickname, summary, policy_number, internal_reference, status, category:product_categories(name)").in("id", policyIds) : { data: [] };
  const policyById = new Map((policies ?? []).map((p) => [p.id, p]));
  const methodById = new Map((methods ?? []).map((m) => [m.id, m]));
  const rows = subs ?? [];
  const pastDue = rows.filter((s) => s.status === "past_due");

  return (
    <div>
      <Breadcrumbs items={[{ label: "Payments" }, { label: "Recurring payments" }]} />
      <PageHeader
        title="Recurring payments"
        description="Premiums you pay for family in Ghana, collected automatically from your saved card. Each collection goes straight to the insurer in cedis; the amount in your currency is indicative."
        actions={
          <>
            <Link href="/account/payments/instalments" className={buttonClass("ghost", "sm")}>Instalments</Link>
            <Link href="/account/payments/methods" className={buttonClass("secondary", "sm")}><CreditCard aria-hidden className="size-4" /> Saved cards</Link>
          </>
        }
      />
      {pastDue.length > 0 && (
        <Notice tone="danger" className="mb-5" title={`${pastDue.length} collection${pastDue.length === 1 ? "" : "s"} failed`}>
          Update your card under Saved cards, or pay the premium from the policy page. The insurer keeps cover in force for its grace period and may lapse it afterwards.
        </Notice>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={<RefreshCw aria-hidden className="size-6" />}
          title="No recurring payments yet"
          body="When you pay for a relative's cover by card you can tick “pay monthly as a sponsor” at checkout and we collect the next premiums for you."
          action={<Link href="/account/policies" className={buttonClass("primary", "sm")}>My policies</Link>}
        />
      ) : (
        <ul className="space-y-4">
          {rows.map((s) => {
            const sum = subscriptionSummary(s);
            const policy = s.policy_id ? policyById.get(s.policy_id) : undefined;
            const method = s.payment_method_id ? methodById.get(s.payment_method_id) : undefined;
            const cat = policy?.category as unknown as { name: string } | null;
            return (
              <Card key={s.id} as="li" className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {policy ? <Link href={`/account/policies/${policy.id}`} className="hover:text-brand hover:underline">{policyTitle({ ...policy, category: cat })}</Link> : "Policy"}
                      {policy && <span className="font-normal text-muted"> · {policy.policy_number ?? policy.internal_reference}</span>}
                    </p>
                    <p className="mt-1 text-sm text-ink-2">{sum.amountLabel}</p>
                    <p className="mt-1 text-sm text-muted">
                      {sum.nextChargeLabel}
                      {s.last_charged_at ? ` · last collected ${formatDate(s.last_charged_at)}` : ""}
                      {sum.failures > 0 ? ` · ${sum.failures} failed attempt${sum.failures === 1 ? "" : "s"}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-subtle">
                      {method ? `${method.brand ?? "Card"} •••• ${method.last4 ?? "····"}${method.status !== "active" ? ` (${method.status})` : ""}` : s.psp === "simulator" ? "Sandbox card" : "No saved card — add one under Saved cards"}
                      {s.display_currency !== "GHS" && s.fx_rate ? ` · indicative rate 1 ${s.display_currency} ≈ ${formatMoney(Number(s.fx_rate), "GHS", 4)} (${s.fx_source ?? "manual"})` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Pill tone={sum.tone}>{sum.statusLabel}</Pill>
                    <SubscriptionActions status={s.status} pause={pauseSponsorSubscription.bind(null, s.id)} resume={resumeSponsorSubscription.bind(null, s.id)} cancel={cancelSponsorSubscription.bind(null, s.id)} />
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted">{sum.hint}</p>
              </Card>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-xs text-subtle">Covva never holds your premium: every collection is paid to the insurer through an authorised payment provider. Pausing or cancelling does not cancel the policy itself — the insurer decides on lapses after its grace period.</p>
    </div>
  );
}
