"use client";
import { useActionState, useState } from "react";
import { Checkbox, DisclosureBlock, Input } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { confirmBrokerChange, declineBrokerChange } from "./actions";

/**
 * Customer consent to a change of broker of record. Shows the new broker's mandatory
 * disclosure; "I understand and agree" records a `broker_change` disclosure for the new
 * broker (the database requires it before the request can move). Declining keeps the
 * current broker.
 */
export function BrokerChangeForm({ requestId, taskId, disclosure, newBroker, currentBroker, reason }: { requestId: string; taskId: string; disclosure: string; newBroker: string; currentBroker: string; reason?: string | null }) {
  const [agreeState, agree] = useActionState(confirmBrokerChange, initialActionState);
  const [declineState, decline] = useActionState(declineBrokerChange, initialActionState);
  const [showDecline, setShowDecline] = useState(false);
  if (agreeState.ok || declineState.ok) return <FormMessage state={agreeState.ok ? agreeState : declineState} />;

  return (
    <div className="max-w-xl space-y-4 rounded-card border border-line bg-white p-5">
      <p className="text-sm text-ink-2">
        <span className="font-semibold">{currentBroker}</span> proposes that <span className="font-semibold">{newBroker}</span> takes over as your broker of record for this request.
        {reason ? <> Their reason: “{reason}”.</> : null} Nothing changes until you agree, and you can keep your current broker.
      </p>
      <DisclosureBlock text={disclosure} />
      <form action={agree} className="space-y-3">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="taskId" value={taskId} />
        <Checkbox name="agree" label={`I understand who provides what and agree to ${newBroker} becoming my broker of record for this request.`} />
        <FormMessage state={agreeState} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton size="md" pendingText="Recording…">I understand and agree</SubmitButton>
          <button type="button" onClick={() => setShowDecline((v) => !v)} className="text-sm font-medium text-muted hover:text-ink">
            Keep my current broker
          </button>
        </div>
      </form>
      {showDecline && (
        <form action={decline} className="space-y-3 border-t border-line pt-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="taskId" value={taskId} />
          <label htmlFor="bc-decline-reason" className="block text-sm text-ink-2">Tell your broker why (optional)</label>
          <Input id="bc-decline-reason" name="reason" maxLength={500} placeholder="e.g. I'd rather stay with the team I know" />
          <FormMessage state={declineState} />
          <SubmitButton variant="outline" size="sm" pendingText="Sending…">Keep {currentBroker}</SubmitButton>
        </form>
      )}
    </div>
  );
}
