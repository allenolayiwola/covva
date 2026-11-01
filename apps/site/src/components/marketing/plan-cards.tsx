import Link from "next/link";
import { Check } from "lucide-react";
import { Pill, buttonClass, cn } from "@im/ui";
import { formatGHS } from "@im/core";
import type { Row } from "@im/db";

type Plan = Row<"plans">;

function features(p: Plan): string[] {
  return Array.isArray(p.features) ? p.features.filter((f): f is string => typeof f === "string") : [];
}

/** SaaS plan cards (from `getPlans()`), always labelled as indicative. */
export function PlanCards({ plans, ctaHref = "#enquire", ctaLabel = "Talk to us", highlightIndex = 1 }: { plans: Plan[]; ctaHref?: string; ctaLabel?: string; highlightIndex?: number }) {
  if (plans.length === 0) {
    return <p className="rounded-card border border-dashed border-line bg-white p-6 text-muted">Plans are being finalised. Contact us for indicative terms.</p>;
  }
  return (
    <div>
      <ul className={cn("grid gap-4", plans.length >= 3 ? "lg:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2" : "max-w-md")}>
        {plans.map((p, i) => {
          const featured = plans.length >= 3 && i === highlightIndex;
          const fee = Number(p.monthly_fee);
          return (
            <li
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-[20px] border bg-white p-6 sm:p-7",
                featured ? "border-brand shadow-float ring-1 ring-brand" : "border-line",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-ink">{p.name}</h3>
                {featured && <Pill tone="ok">Most popular for pilots</Pill>}
              </div>
              {p.description && <p className="mt-2 text-sm leading-relaxed text-muted">{p.description.replace(/\s*Indicative pricing, to be agreed\.?/i, "")}</p>}
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-[32px] font-bold tracking-tight text-ink tabular-nums">{fee > 0 ? formatGHS(fee) : "No fee"}</span>
                {fee > 0 && <span className="text-sm text-muted">/ month</span>}
              </p>
              <dl className="mt-3 space-y-1 text-[13px] text-muted">
                <div className="flex justify-between gap-3"><dt>Seats included</dt><dd className="font-medium text-ink-2">{p.included_seats ?? "Custom"}</dd></div>
                {(p.included_requests !== null || p.audience === "broker") && (
                  <div className="flex justify-between gap-3"><dt>Requests included</dt><dd className="font-medium text-ink-2">{p.included_requests ?? "Custom"}</dd></div>
                )}
                {Number(p.per_request_fee) > 0 && (
                  <div className="flex justify-between gap-3"><dt>Per additional request</dt><dd className="font-medium text-ink-2">{formatGHS(Number(p.per_request_fee), { decimals: true })}</dd></div>
                )}
                {Number(p.per_active_policy_fee) > 0 && (
                  <div className="flex justify-between gap-3"><dt>Per active policy / month</dt><dd className="font-medium text-ink-2">{formatGHS(Number(p.per_active_policy_fee), { decimals: true })}</dd></div>
                )}
              </dl>
              <ul className="mt-6 space-y-2.5 border-t border-line pt-6">
                {features(p).map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm text-ink-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={2.5} />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-7">
                <Link href={ctaHref} className={buttonClass(featured ? "primary" : "secondary", "md", "w-full")}>{ctaLabel}</Link>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-muted">
        <span className="font-semibold text-ink-2">Indicative pricing, to be agreed.</span> Prices exclude applicable taxes. Final terms are set out in heads of terms and the partner agreement.
      </p>
    </div>
  );
}
