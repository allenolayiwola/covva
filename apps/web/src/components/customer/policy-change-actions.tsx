"use client";
import { useActionState } from "react";
import { Field, Select, Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "./form-bits";
import { initialActionState, type ActionState } from "./utils";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Agree to the quoted change in premium (and pay any additional premium to the insurer). */
export function AgreeChangeForm({ action, amount, currency }: { action: Act; amount: number; currency: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="space-y-3">
      {amount > 0 && (
        <Field label="Pay with" htmlFor="change-channel">
          <Select id="change-channel" name="channel" defaultValue="mobile_money">
            <option value="mobile_money">Mobile money</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank transfer</option>
          </Select>
        </Field>
      )}
      <SubmitButton size="sm" pendingText="Please wait…">{amount > 0 ? `Agree and pay ${currency} ${amount.toFixed(2)}` : "Agree to the change"}</SubmitButton>
      {amount > 0 && <p className="text-xs text-muted">The payment goes to the insurer. Your policy changes only once the insurer confirms it.</p>}
      <FormMessage state={state} />
    </form>
  );
}

export function WithdrawChangeForm({ action }: { action: Act }) {
  const [state, formAction] = useActionState(action, initialActionState);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={formAction} className="space-y-2">
      <label htmlFor="withdraw-reason" className="text-sm text-ink-2">Reason (optional)</label>
      <Textarea id="withdraw-reason" name="reason" rows={2} className="min-h-14 text-sm" />
      <SubmitButton size="sm" variant="secondary" pendingText="Withdrawing…">Withdraw this change</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
