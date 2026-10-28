import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Timer } from "lucide-react";
import { PERIOD_LABEL, formatDateTime, formatGHS, isPolicyPeriod } from "@im/core";
import { Card, EmptyState, PageHeader, Pill, buttonClass } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { MomoPayForm } from "@/components/customer/momo-pay-form";
import { getProfile } from "@/lib/auth";
import { listMicroPolicies } from "@/server/micro";
import { account } from "../_lib/data";
import { renewMicroNow } from "./actions";
import { AutoRenewToggle } from "./auto-renew-toggle";

export const metadata: Metadata = { title: "Micro cover" };

export default function MicroAccountPage({ searchParams }: PageProps<"/account/micro">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <MicroAccount searchParams={searchParams} />
    </Suspense>
  );
}

async function MicroAccount({ searchParams }: Pick<PageProps<"/account/micro">, "searchParams">) {
  const { user } = await account("/account/micro");
  const sp = await searchParams;
  const focus = typeof sp.renew === "string" ? sp.renew : null;
  const [policies, profile] = await Promise.all([listMicroPolicies(user.id), getProfile()]);
  return (
    <div>
      <Breadcrumbs items={[{ label: "Micro cover" }]} />
      <PageHeader title="Micro cover" description="Your daily, weekly and monthly cover. Each window is paid to the insurer by mobile money or card." actions={<Link href="/micro" className={buttonClass("primary", "sm")}>Buy cover</Link>} />
      {policies.length === 0 ? (
        <EmptyState icon={<Timer aria-hidden className="size-6" />} title="No micro cover yet" body="Cover by the day, week or month for drivers, traders, artisans and event organisers." action={<Link href="/micro" className={buttonClass("primary", "sm")}>See products</Link>} />
      ) : (
        <ul className="space-y-4">
          {policies.map((p) => {
            const period = isPolicyPeriod(p.period) ? p.period : "day";
            return (
              <Card key={p.id} as="li" className={`p-5 ${focus === p.id ? "ring-2 ring-brand" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink"><Link href={`/account/policies/${p.id}`} className="hover:text-brand hover:underline">{p.summary ?? "Micro cover"}</Link> <span className="font-normal text-muted">· {p.policy_number ?? p.internal_reference}</span></p>
                    <p className="mt-1 text-sm text-ink-2">
                      {p.covered && p.current ? `Covered until ${formatDateTime(p.current.ends_at)}` : p.status === "pending_issuance" ? "Paid — the insurer is issuing your cover" : p.latest ? `Last window ended ${formatDateTime(p.latest.ends_at)}` : "Not covered right now"}
                    </p>
                    <p className="mt-1 text-xs text-subtle">Sold by the {PERIOD_LABEL[period].noun}{p.latest ? ` · last paid ${formatGHS(Number(p.latest.amount), { decimals: true })}` : ""}</p>
                  </div>
                  <Pill tone={p.covered ? "ok" : p.status === "pending_issuance" ? "wait" : "neutral"}>{p.covered ? "Covered" : p.status === "pending_issuance" ? "Issuing" : "Not covered"}</Pill>
                </div>
                {["active", "expired"].includes(p.status) && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                    <MomoPayForm action={renewMicroNow.bind(null, p.id)} label={`Renew for 1 ${PERIOD_LABEL[period].noun}`} defaultPhone={profile?.phone ?? ""} compact allowCard />
                    <AutoRenewToggle policyId={p.id} initial={p.auto_renew} />
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-xs text-subtle">A renewal starts when your current window ends, so there is no gap. Covva never holds your money: each payment goes to the insurer.</p>
    </div>
  );
}
