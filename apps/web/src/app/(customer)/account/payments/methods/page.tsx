import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CreditCard } from "lucide-react";
import { formatDate } from "@im/core";
import { Card, EmptyState, PageHeader, Pill, buttonClass } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { account } from "../../_lib/data";
import { makeDefaultMethod, removeMethod } from "./actions";
import { MethodActions } from "./method-actions";

export const metadata: Metadata = { title: "Saved cards" };

const PSP_LABEL: Record<string, string> = { paystack_intl: "International card via Paystack", paystack: "Card via Paystack", stripe: "Card via Stripe", simulator: "Sandbox card (no real money)" };

export default function MethodsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Methods />
    </Suspense>
  );
}

async function Methods() {
  const { user, supabase } = await account("/account/payments/methods");
  // RLS: own rows only. Token references are never selected.
  const { data } = await supabase
    .from("payment_methods")
    .select("id, psp, brand, last4, exp_month, exp_year, billing_country, currency, is_default, status, created_at")
    .eq("user_id", user.id)
    .neq("status", "revoked")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  return (
    <div>
      <Breadcrumbs items={[{ label: "Payments", href: "/account/payments/subscriptions" }, { label: "Saved cards" }]} />
      <PageHeader
        title="Saved cards"
        description="Cards kept for recurring premium collections. We store only the payment provider's token and the last four digits — never your card number."
        actions={<Link href="/account/payments/subscriptions" className={buttonClass("secondary", "sm")}>Recurring payments</Link>}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<CreditCard aria-hidden className="size-6" />} title="No saved cards" body="Tick “keep my card for future premiums” when you next pay by card, and it appears here for recurring sponsor payments." />
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <Card key={m.id} as="li" className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="flex items-center gap-4">
                <span className="grid size-11 place-items-center rounded-xl bg-mist text-brand"><CreditCard aria-hidden className="size-5" /></span>
                <div>
                  <p className="font-semibold text-ink">
                    {m.brand ?? "Card"} •••• {m.last4 ?? "····"}
                    {m.is_default && <Pill tone="ok" className="ml-2">Default</Pill>}
                    {m.status === "expired" && <Pill tone="danger" className="ml-2">Expired</Pill>}
                  </p>
                  <p className="text-sm text-muted">
                    {m.exp_month && m.exp_year ? `Expires ${String(m.exp_month).padStart(2, "0")}/${m.exp_year} · ` : ""}
                    {PSP_LABEL[m.psp] ?? m.psp}
                    {m.billing_country ? ` · ${m.billing_country}` : ""}
                    {m.currency ? ` · pays in ${m.currency}` : ""} · added {formatDate(m.created_at)}
                  </p>
                </div>
              </div>
              <MethodActions isDefault={m.is_default} makeDefault={makeDefaultMethod.bind(null, m.id)} remove={removeMethod.bind(null, m.id)} />
            </Card>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-subtle">Removing a card revokes its use for future collections; it is never deleted from our records, which the audit log requires. Premiums are charged in Ghana cedis to the insurer; your card issuer converts and may add a foreign transaction fee.</p>
    </div>
  );
}
