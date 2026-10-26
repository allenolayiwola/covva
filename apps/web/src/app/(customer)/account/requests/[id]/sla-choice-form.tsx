"use client";
import { useActionState } from "react";
import { Notice } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { chooseSlaOutcome } from "./actions";

/** Shown after a final SLA breach: refund, or re-route to another insurer/broker. */
export function SlaChoiceForm({ requestId, insurerName, dueAt }: { requestId: string; insurerName: string | null; dueAt: string }) {
  const [state, action] = useActionState(chooseSlaOutcome, initialActionState);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <Notice tone="danger" title="The insurer missed the agreed service level">
      <p>
        {insurerName ?? "The insurer"} was expected to issue your policy by {dueAt} and has not. You decide what happens next — your money is safe either way.
      </p>
      <form action={action} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <SubmitButton name="choice" value="refund" variant="outline" size="sm" pendingText="Working…">Get a refund</SubmitButton>
        <SubmitButton name="choice" value="reroute" size="sm" pendingText="Working…">Find another insurer</SubmitButton>
      </form>
      <p className="mt-2 text-xs">Both options refund the premium you paid to this insurer. “Find another insurer” also re-runs the search with this insurer excluded.</p>
      <FormMessage state={state} className="mt-2" />
    </Notice>
  );
}
