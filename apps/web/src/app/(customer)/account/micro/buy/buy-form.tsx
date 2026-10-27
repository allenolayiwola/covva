"use client";
import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { PERIOD_LABEL, formatGHS, type MicroCoverPeriod } from "@im/core";
import { Checkbox, Field, Input, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { buyMicro } from "../actions";

const METHODS = [
  { value: "mtn", label: "MTN MoMo" },
  { value: "vod", label: "Telecel Cash" },
  { value: "atl", label: "AirtelTigo Money" },
  { value: "card", label: "Card" },
] as const;

/** Three taps: period → mobile money number → pay. */
export function MicroBuyForm({ versionId, prices, insurer, defaultPhone }: { versionId: string; prices: { period: MicroCoverPeriod; amount: number }[]; insurer: string; defaultPhone: string }) {
  const [state, action] = useActionState(buyMicro, initialActionState);
  const [period, setPeriod] = React.useState<MicroCoverPeriod>(prices[0]?.period ?? "day");
  const [method, setMethod] = React.useState<(typeof METHODS)[number]["value"]>("mtn");
  const router = useRouter();
  React.useEffect(() => {
    const url = state.data?.url;
    if (typeof url === "string" && /^https?:\/\//.test(url)) window.location.assign(url);
    else if (typeof state.data?.next === "string" && state.ok) {
      const t = setTimeout(() => router.push(String(state.data!.next)), 2500);
      return () => clearTimeout(t);
    }
  }, [state, router]);
  const price = prices.find((p) => p.period === period);
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="version" value={versionId} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">1. How long?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {prices.map((p) => (
            <label key={p.period} className={cn("flex cursor-pointer flex-col gap-1 rounded-xl border p-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", period === p.period ? "border-brand bg-mint-2" : "border-line hover:bg-mist")}>
              <input type="radio" name="period" value={p.period} checked={period === p.period} onChange={() => setPeriod(p.period)} className="sr-only" />
              <span className="font-medium text-ink">1 {PERIOD_LABEL[p.period].noun}</span>
              <span className="text-lg font-bold text-ink">{formatGHS(p.amount, { decimals: true })}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">2. Pay with</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          {METHODS.map((m) => (
            <label key={m.value} className={cn("flex cursor-pointer items-center justify-center rounded-xl border p-3 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", method === m.value ? "border-brand bg-mint-2 text-brand-deep" : "border-line text-ink-2 hover:bg-mist")}>
              <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="sr-only" />
              {m.label}
            </label>
          ))}
        </div>
        {method !== "card" && (
          <Field label="Mobile money number" htmlFor="phone" error={state.fieldErrors?.phone} hint="You'll get a prompt on this phone to approve with your PIN." className="mt-3">
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={defaultPhone} placeholder="024 123 4567" />
          </Field>
        )}
      </fieldset>
      <Checkbox name="auto_renew" label={<span className="text-sm text-ink-2">Renew automatically before my cover ends (you can turn this off any time)</span>} />
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full sm:w-auto" pendingText="Starting payment…">3. Pay {price ? formatGHS(price.amount, { decimals: true }) : ""}</SubmitButton>
      <p className="text-xs text-subtle">Your payment goes straight to {insurer}. Covva is a technology platform and never holds your money. Cover starts when {insurer} issues the policy.</p>
    </form>
  );
}
