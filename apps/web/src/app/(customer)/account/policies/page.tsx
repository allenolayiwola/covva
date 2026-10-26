import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Shield } from "lucide-react";
import { POLICY_STATUS, daysUntil, formatDate, formatGHS } from "@im/core";
import { EmptyState, PageHeader, Pill, StatusPill, buttonClass } from "@im/ui";
import { CategoryIcon } from "@/components/customer/category-icon";
import { ListSkeleton } from "@/components/customer/skeletons";
import { POLICY_SELECT, account, coverLabel, policyTitle, type PolicyWithRefs } from "../_lib/data";

export const metadata: Metadata = { title: "My policies" };

export default function PoliciesPage() {
  return (
    <>
      <PageHeader
        title="My policies"
        description="Your policy wallet: every policy, its documents and who to call."
        actions={
          <>
            <Link href="/account/policies/new" className={buttonClass("secondary")}>Add a policy bought elsewhere</Link>
            <Link href="/account/requests/new" className={buttonClass("primary")}>
              <Plus aria-hidden className="size-4" /> Get a new quote
            </Link>
          </>
        }
      />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <Wallet />
      </Suspense>
    </>
  );
}

async function Wallet() {
  const { user, supabase } = await account("/account/policies");
  const { data } = await supabase.from("policies").select(POLICY_SELECT).eq("customer_id", user.id).order("cover_end", { ascending: true, nullsFirst: false });
  const policies = (data ?? []) as unknown as PolicyWithRefs[];
  if (!policies.length) {
    return (
      <EmptyState
        icon={<Shield className="size-5" />}
        title="Your wallet is empty"
        body="Policies you buy here appear automatically once the insurer issues them. You can also add policies you bought elsewhere to keep everything in one place."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/explore" className={buttonClass("primary")}>Explore cover</Link>
            <Link href="/account/policies/new" className={buttonClass("secondary")}>Add a policy</Link>
          </div>
        }
      />
    );
  }
  const current = policies.filter((p) => p.status === "active" || p.status === "pending_issuance");
  const past = policies.filter((p) => !current.includes(p));
  return (
    <div className="space-y-10">
      <PolicyGrid title="Current" policies={current} empty="No current policies." />
      {past.length > 0 && <PolicyGrid title="Past" policies={past} />}
    </div>
  );
}

function PolicyGrid({ title, policies, empty }: { title: string; policies: PolicyWithRefs[]; empty?: string }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-lg font-semibold text-ink">{title}</h2>
      {!policies.length && empty && <p className="text-sm text-muted">{empty}</p>}
      <ul className="grid gap-4 md:grid-cols-2">
        {policies.map((p) => {
          const days = p.status === "active" ? daysUntil(p.cover_end) : null;
          return (
            <li key={p.id}>
              <Link href={`/account/policies/${p.id}`} className="block h-full rounded-card border border-line bg-white p-5 transition-colors hover:border-brand">
                <div className="flex items-start gap-3">
                  <CategoryIcon icon={p.category?.icon} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted">{coverLabel(p.category?.name, p.insured_items as Record<string, unknown>)}</p>
                    <p className="truncate text-[17px] font-semibold text-ink">{policyTitle(p)}</p>
                    <p className="truncate text-sm text-muted">{p.insurer?.name} · {p.policy_number ?? p.internal_reference}</p>
                  </div>
                  <StatusPill meta={POLICY_STATUS[p.status]} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">Cover ends</dt>
                    <dd className="font-medium text-ink">{formatDate(p.cover_end)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Premium</dt>
                    <dd className="font-medium text-ink">{p.premium ? `${formatGHS(Number(p.premium))} / ${p.billing_period === "month" ? "mo" : "yr"}` : "—"}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {days !== null && days >= 0 && days <= 60 && <Pill tone="wait">Renewal in {days} day{days === 1 ? "" : "s"}</Pill>}
                  {p.external_source && <Pill tone="neutral">Added by you</Pill>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
