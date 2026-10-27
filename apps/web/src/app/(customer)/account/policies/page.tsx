import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Shield } from "lucide-react";
import { POLICY_STATUS, daysUntil, formatDate, formatGHS } from "@im/core";
import { EmptyState, PageHeader, Pill, StatusPill, buttonClass } from "@im/ui";
import { CategoryIcon } from "@/components/customer/category-icon";
import { ListSkeleton } from "@/components/customer/skeletons";
import { POLICY_SELECT, account, coverLabel, policyTitle, type PolicyWithRefs } from "../_lib/data";
import type { Translator } from "@im/core";
import { T } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "My policies" };

export default function PoliciesPage() {
  return (
    <>
      <PageHeader
        title={<T k="wallet.title" />}
        description={<T k="wallet.description" />}
        actions={
          <>
            <Link href="/account/policies/new" className={buttonClass("secondary")}><T k="wallet.addElsewhere" /></Link>
            <Link href="/account/requests/new" className={buttonClass("primary")}>
              <Plus aria-hidden className="size-4" /> <T k="wallet.newQuote" />
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
  const t = await getT();
  const { data } = await supabase.from("policies").select(POLICY_SELECT).eq("customer_id", user.id).order("cover_end", { ascending: true, nullsFirst: false });
  const policies = (data ?? []) as unknown as PolicyWithRefs[];
  if (!policies.length) {
    return (
      <EmptyState
        icon={<Shield className="size-5" />}
        title={t("wallet.emptyTitle")}
        body={t("wallet.emptyBody")}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/explore" className={buttonClass("primary")}>{t("wallet.explore")}</Link>
            <Link href="/account/policies/new" className={buttonClass("secondary")}>{t("wallet.addPolicy")}</Link>
          </div>
        }
      />
    );
  }
  const current = policies.filter((p) => p.status === "active" || p.status === "pending_issuance");
  const past = policies.filter((p) => !current.includes(p));
  return (
    <div className="space-y-10">
      <PolicyGrid t={t} title={t("wallet.current")} policies={current} empty={t("wallet.noCurrent")} />
      {past.length > 0 && <PolicyGrid t={t} title={t("wallet.past")} policies={past} />}
    </div>
  );
}

function PolicyGrid({ t, title, policies, empty }: { t: Translator; title: string; policies: PolicyWithRefs[]; empty?: string }) {
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
                    <p className="truncate text-sm text-muted">{p.insurer?.name ?? p.external_insurer_name ?? t("wallet.insurerNotListed")} · {p.policy_number ?? p.internal_reference}</p>
                  </div>
                  <StatusPill meta={POLICY_STATUS[p.status]} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">{t("wallet.coverEnds")}</dt>
                    <dd className="font-medium text-ink">{formatDate(p.cover_end)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("wallet.premium")}</dt>
                    <dd className="font-medium text-ink">{p.premium ? `${formatGHS(Number(p.premium))} / ${p.billing_period === "month" ? "mo" : "yr"}` : "—"}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {days !== null && days >= 0 && days <= 60 && <Pill tone="wait">{t("wallet.renewalIn", { days })}</Pill>}
                  {p.external_source && <Pill tone="neutral">{t("wallet.addedByYou")}</Pill>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
