import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock } from "lucide-react";
import { INSTALMENT_PLAN_LABEL, SCHEDULE_STATE_LABEL, formatDate, formatGHS, instalmentProgressLine, isInstalmentPlanKey, parseInstalmentPlan, planRulesText, reinstatementAllowed } from "@im/core";
import { Card, EmptyState, Notice, PageHeader, Pill, buttonClass } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { MomoPayForm } from "@/components/customer/momo-pay-form";
import { getProfile } from "@/lib/auth";
import { listSchedulesForUser } from "@/server/instalments";
import { account } from "../../_lib/data";
import { payInstalmentNow, reinstateSchedule } from "./actions";

export const metadata: Metadata = { title: "Instalments" };

export default function InstalmentsPage({ searchParams }: PageProps<"/account/payments/instalments">) {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Instalments searchParams={searchParams} />
    </Suspense>
  );
}

async function Instalments({ searchParams }: Pick<PageProps<"/account/payments/instalments">, "searchParams">) {
  const { user } = await account("/account/payments/instalments");
  const sp = await searchParams;
  const focus = typeof sp.pay === "string" ? sp.pay : null;
  const [schedules, profile] = await Promise.all([listSchedulesForUser(user.id), getProfile()]);
  const atRisk = schedules.filter((s) => s.state.state === "grace" || s.state.state === "overdue");
  const now = new Date();

  return (
    <div>
      <Breadcrumbs items={[{ label: "Payments", href: "/account/payments" }, { label: "Instalments" }]} />
      <PageHeader
        title="Instalments"
        description="Premiums you pay in parts under the insurer's plan. Each payment goes straight to the insurer in cedis — Covva never holds your money."
        actions={<Link href="/account/payments/subscriptions" className={buttonClass("secondary", "sm")}>Recurring payments</Link>}
      />
      {atRisk.length > 0 && (
        <Notice tone="danger" className="mb-5" title={`${atRisk.length} payment${atRisk.length === 1 ? "" : "s"} overdue`}>
          Your cover stays in force during the insurer&apos;s grace period. Pay now to avoid a lapse.
        </Notice>
      )}
      {schedules.length === 0 ? (
        <EmptyState icon={<CalendarClock aria-hidden className="size-6" />} title="No instalment plans" body="When an insurer offers instalments you can choose “pay monthly” or “pay every 3 months” at checkout." action={<Link href="/account/policies" className={buttonClass("primary", "sm")}>My policies</Link>} />
      ) : (
        <ul className="space-y-4">
          {schedules.map((s) => {
            const meta = SCHEDULE_STATE_LABEL[s.state.state];
            const plan = parseInstalmentPlan(s.plan);
            const rein = reinstatementAllowed(s, now);
            const next = s.instalments.find((i) => i.status === "due" || i.status === "failed");
            return (
              <Card key={s.id} as="li" className={`p-5 ${focus && next?.id === focus ? "ring-2 ring-brand" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {s.policy ? <Link href={`/account/policies/${s.policy.id}`} className="hover:text-brand hover:underline">{s.policy.summary ?? "Policy"}</Link> : "Policy"}
                      {s.policy && <span className="font-normal text-muted"> · {s.policy.policy_number ?? s.policy.internal_reference}</span>}
                    </p>
                    <p className="mt-1 text-sm text-ink-2">{instalmentProgressLine(s.state)}</p>
                    <p className="mt-1 text-sm text-muted">
                      {isInstalmentPlanKey(s.plan_key) ? INSTALMENT_PLAN_LABEL[s.plan_key] : s.plan_key} · total {formatGHS(Number(s.total_amount), { decimals: true })} · paid {formatGHS(s.state.paidAmount, { decimals: true })}
                      {s.state.arrears > 0 ? ` · overdue ${formatGHS(s.state.arrears, { decimals: true })}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-subtle">{s.channel === "card" ? "Collected from your saved card" : `Mobile money prompt${s.momo_phone ? ` to ${s.momo_phone}` : ""}`}{s.state.graceUntil && s.state.state !== "lapsed" ? ` · grace until ${formatDate(s.state.graceUntil)}` : ""}</p>
                  </div>
                  <Pill tone={meta.tone}>{s.reinstatement_review === "pending" ? "Reinstatement under review" : meta.label}</Pill>
                </div>
                {s.state.state === "lapsed" ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm text-ink-2">{rein.reason}{rein.deadline && rein.allowed ? ` Until ${formatDate(rein.deadline)}.` : ""}</p>
                    {rein.allowed && s.reinstatement_review !== "pending" && <MomoPayForm action={reinstateSchedule.bind(null, s.id)} label={`Reinstate · pay ${formatGHS(s.state.arrears, { decimals: true })}`} defaultPhone={profile?.phone ?? ""} compact allowCard />}
                  </div>
                ) : next && s.state.state !== "completed" && s.state.state !== "cancelled" ? (
                  <div className="mt-4">
                    <MomoPayForm action={payInstalmentNow.bind(null, next.id)} label={`Pay ${formatGHS(s.state.arrears > 0 ? s.state.arrears : Number(next.amount), { decimals: true })} now`} defaultPhone={profile?.phone ?? ""} compact allowCard={s.channel === "card"} />
                  </div>
                ) : null}
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-muted">Schedule and the insurer&apos;s rules</summary>
                  <ol className="mt-2 divide-y divide-line">
                    {s.instalments.map((i) => (
                      <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span className="text-muted">#{i.seq} · {formatDate(i.due_at)}</span>
                        <span className="text-ink-2">{formatGHS(Number(i.amount), { decimals: true })} · {i.status === "paid" ? `paid ${i.paid_at ? formatDate(i.paid_at) : ""}` : i.status}</span>
                      </li>
                    ))}
                  </ol>
                  {plan && (
                    <ul className="mt-2 space-y-1 text-xs text-ink-2">
                      {planRulesText(plan).map((t) => <li key={t}>• {t}</li>)}
                    </ul>
                  )}
                </details>
              </Card>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-xs text-subtle">Grace periods, lapses and reinstatement are the insurer&apos;s rules for your plan; Covva applies them and keeps you informed. Mobile money payments need you to approve the prompt on your phone.</p>
    </div>
  );
}
