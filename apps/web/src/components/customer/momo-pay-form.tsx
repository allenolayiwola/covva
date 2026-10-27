"use client";
import * as React from "react";
import { useActionState } from "react";
import { Button, Field, Input, Select, cn } from "@im/ui";
import { FormMessage } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";

type Bound = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Small "pay by mobile money" form for instalments, reinstatement and micro renewals. The bound
 * Server Action returns `data.url` when the payer must finish on a hosted page (card / sandbox).
 */
export function MomoPayForm({ action, label, defaultPhone = "", compact = false, allowCard = false, className }: { action: Bound; label: string; defaultPhone?: string; compact?: boolean; allowCard?: boolean; className?: string }) {
  const [state, run, pending] = useActionState(action, initialActionState);
  const [method, setMethod] = React.useState<"mtn" | "vod" | "atl" | "card">("mtn");
  const id = React.useId();
  React.useEffect(() => {
    const url = state.data?.url;
    if (typeof url === "string" && /^https?:\/\//.test(url)) window.location.assign(url);
  }, [state.data]);
  return (
    <form action={run} className={cn("space-y-2", className)}>
      <div className={cn("grid gap-2", compact ? "sm:grid-cols-[140px_1fr_auto] sm:items-end" : "sm:grid-cols-2")}>
        <Field label="Pay with" htmlFor={`${id}-m`}>
          <Select id={`${id}-m`} name="method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="mtn">MTN MoMo</option>
            <option value="vod">Telecel Cash</option>
            <option value="atl">AirtelTigo Money</option>
            {allowCard && <option value="card">Saved card</option>}
          </Select>
        </Field>
        {method !== "card" && (
          <Field label="Mobile money number" htmlFor={`${id}-p`} error={state.fieldErrors?.phone}>
            <Input id={`${id}-p`} name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={defaultPhone} placeholder="024 123 4567" />
          </Field>
        )}
        <Button type="submit" size="sm" loading={pending} className={compact ? "" : "sm:col-span-2 sm:w-auto"}>{label}</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
