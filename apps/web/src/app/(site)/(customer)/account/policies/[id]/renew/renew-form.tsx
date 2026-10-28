"use client";
import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { formatGHS } from "@im/core";
import { cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";
import { requestRenewal } from "../../actions";

export interface RenewToggle {
  key: string;
  label: string;
  detail: string;
  /** "same" toggles start on (unchanged); "add" toggles start off (an addition). */
  kind: "same" | "add";
  /** Text recorded for the broker when this is changed. */
  changeText: string;
  /** Turning this off/on means the risk details need re-entering. */
  needsNewDetails?: boolean;
  /** Rough pricing effect used only for the estimate range. */
  priceFactor?: number;
}

function Switch({ checked, onChange, id, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; id: string; labelledBy: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        checked ? "bg-brand" : "bg-line",
      )}
    >
      <span className={cn("inline-block size-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-7" : "translate-x-1")} />
    </button>
  );
}

export function RenewForm({
  policyId,
  toggles,
  lastPremium,
  claimsThisYear,
  messageHref,
}: {
  policyId: string;
  toggles: RenewToggle[];
  lastPremium: number | null;
  claimsThisYear: number;
  messageHref: string;
}) {
  const [state, action] = useActionState(requestRenewal.bind(null, policyId) as (s: ActionState, f: FormData) => Promise<ActionState>, initialActionState);
  const [values, setValues] = React.useState<Record<string, boolean>>(() => Object.fromEntries(toggles.map((t) => [t.key, t.kind === "same"])));
  const changed = toggles.filter((t) => (t.kind === "same" ? !values[t.key] : values[t.key]));
  const needsNewDetails = changed.some((t) => t.needsNewDetails);

  // Indicative range only: last premium ±, nudged by declared changes and claims. Never an offer.
  let range: [number, number] | null = null;
  if (lastPremium) {
    let factor = 1;
    for (const t of changed) factor *= t.priceFactor ?? 1;
    if (claimsThisYear > 0) factor *= 1.1;
    const round = (n: number) => Math.round(n / 50) * 50;
    range = [round(lastPremium * 0.97 * factor), round(lastPremium * 1.09 * factor)];
  }

  return (
    <form action={action} className="space-y-8">
      {changed.map((t) => (
        <input key={t.key} type="hidden" name="changes" value={t.changeText} />
      ))}
      <input type="hidden" name="needs_new_details" value={needsNewDetails ? "1" : "0"} />

      <section aria-labelledby="changed">
        <h2 id="changed" className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-muted">Confirm what has changed</h2>
        <ul className="divide-y divide-line rounded-card border border-line px-5">
          {toggles.map((t) => (
            <li key={t.key} className="flex items-center justify-between gap-4 py-4">
              <div id={`t-${t.key}-l`}>
                <p className="font-medium text-ink">{t.label}</p>
                <p className="text-sm text-muted">{t.detail}</p>
              </div>
              <Switch id={`t-${t.key}`} labelledBy={`t-${t.key}-l`} checked={!!values[t.key]} onChange={(v) => setValues((p) => ({ ...p, [t.key]: v }))} />
            </li>
          ))}
        </ul>
        {needsNewDetails && <p className="mt-2 text-sm text-amber">You&apos;ll update the details on the next screen before your request is sent.</p>}
      </section>

      <section aria-labelledby="compare">
        <h2 id="compare" className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-muted">This year vs last year</h2>
        <dl className="divide-y divide-line">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Last year&apos;s premium</dt>
            <dd className="font-medium text-ink">{lastPremium ? formatGHS(lastPremium) : "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Estimated renewal range</dt>
            <dd className="font-semibold text-ink">{range ? `${formatGHS(range[0])} – ${range[1].toLocaleString("en-GH")}` : "Your broker will advise"}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Claims this year</dt>
            <dd className="font-medium text-ink">{claimsThisYear ? claimsThisYear : "None"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">An estimate, not an offer. Insurers confirm final premiums.</p>
      </section>

      <FormMessage state={state} />
      <div className="space-y-3">
        <SubmitButton size="lg" className="w-full" pendingText="Sending…">
          {needsNewDetails ? "Continue to update details" : "Request renewal options"}
        </SubmitButton>
        <Link href={messageHref} className="block py-2 text-center font-semibold text-brand hover:underline">Talk to my broker first</Link>
      </div>
    </form>
  );
}
