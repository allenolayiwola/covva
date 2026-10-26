"use client";
import { useActionState } from "react";
import { Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { withdrawClaim } from "../actions";

export function WithdrawClaimForm({ claimId }: { claimId: string }) {
  const [state, action] = useActionState(withdrawClaim, initialActionState);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <details className="rounded-xl border border-line px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">Withdraw this claim</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="claimId" value={claimId} />
        <label htmlFor="withdraw-reason" className="block text-sm text-ink-2">Reason (optional)</label>
        <Textarea id="withdraw-reason" name="reason" maxLength={500} className="min-h-20" />
        <p className="text-xs text-subtle">Withdrawing tells your broker and the insurer you no longer wish to claim. You can&apos;t undo this online.</p>
        <FormMessage state={state} />
        <SubmitButton variant="outline" size="sm" pendingText="Withdrawing…">Withdraw claim</SubmitButton>
      </form>
    </details>
  );
}
