"use client";
import { INSTALMENT_PLAN_LABEL, formatDate, formatGHS, planRulesText, type BuiltSchedule, type InstalmentPlan, type InstalmentPlanKey } from "@im/core";
import { cn } from "@im/ui";

/**
 * Checkout: "Pay in instalments" — the insurer's plans for this product version with a schedule
 * preview and the insurer's grace / lapse / reinstatement rules in plain words.
 */
export function InstalmentChoice({
  plans,
  previews,
  value,
  onChange,
  insurer,
}: {
  plans: InstalmentPlan[];
  previews: Partial<Record<InstalmentPlanKey, BuiltSchedule>>;
  value: "" | InstalmentPlanKey;
  onChange: (v: "" | InstalmentPlanKey) => void;
  insurer: string;
}) {
  const chosen = value ? plans.find((p) => p.key === value) : null;
  const preview = value ? previews[value] : null;
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-2">Pay in full or in instalments?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={cn("flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", value === "" ? "border-brand bg-mint-2" : "border-line hover:bg-mist")}>
          <input type="radio" name="instalment_mode" value="" checked={value === ""} onChange={() => onChange("")} className="sr-only" />
          <span className="font-medium text-ink">Pay in full</span>
          <span className="text-xs text-muted">One payment now.</span>
        </label>
        {plans.map((p) => {
          const b = previews[p.key];
          return (
            <label key={p.key} className={cn("flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", value === p.key ? "border-brand bg-mint-2" : "border-line hover:bg-mist")}>
              <input type="radio" name="instalment_mode" value={p.key} checked={value === p.key} onChange={() => onChange(p.key)} className="sr-only" />
              <span className="font-medium text-ink">Pay {INSTALMENT_PLAN_LABEL[p.key].toLowerCase()}</span>
              <span className="text-xs text-muted">{b ? `${b.count} payments, first ${formatGHS(b.deposit, { decimals: true })}${b.surcharge > 0 ? ` · total ${formatGHS(b.total, { decimals: true })}` : ""}` : `${p.count} payments`}</span>
            </label>
          );
        })}
      </div>
      {chosen && preview && (
        <div className="mt-3 rounded-card border border-line p-4 text-sm">
          <p className="font-medium text-ink">Your schedule with {insurer}</p>
          <ol className="mt-2 divide-y divide-line">
            {preview.instalments.slice(0, 4).map((i) => (
              <li key={i.seq} className="flex justify-between gap-2 py-1.5">
                <span className="text-muted">{i.seq === 1 ? "Today" : formatDate(i.dueAt)}</span>
                <span className="font-medium text-ink">{formatGHS(i.amount, { decimals: true })}</span>
              </li>
            ))}
            {preview.instalments.length > 4 && (
              <li className="py-1.5 text-muted">
                … {preview.instalments.length - 4} more, last on {formatDate(preview.instalments[preview.instalments.length - 1]!.dueAt)}
              </li>
            )}
          </ol>
          <p className="mt-2 text-xs text-muted">Total {formatGHS(preview.total, { decimals: true })}{preview.surcharge > 0 ? ` (includes the insurer's ${formatGHS(preview.surcharge, { decimals: true })} instalment charge)` : ""}. Every payment goes to {insurer} in cedis.</p>
          <p className="mt-3 font-medium text-ink">{insurer}&apos;s rules</p>
          <ul className="mt-1 space-y-1 text-xs text-ink-2">
            {planRulesText(chosen).map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Later payments: we send a mobile money prompt to approve on the due date (or charge your saved card). Retries 2 and 5 days later.</p>
        </div>
      )}
    </fieldset>
  );
}
