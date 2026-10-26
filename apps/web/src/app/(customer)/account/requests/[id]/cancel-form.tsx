"use client";
import { useActionState } from "react";
import { Select } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { cancelRequest } from "./actions";

export function CancelRequestForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState(cancelRequest, initialActionState);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <details className="group rounded-xl border border-line px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">Cancel this request</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="requestId" value={requestId} />
        <label htmlFor="cancel-reason" className="block text-sm text-ink-2">Why are you cancelling? (optional)</label>
        <Select id="cancel-reason" name="reason" defaultValue="">
          <option value="">Prefer not to say</option>
          <option value="Found cover elsewhere">Found cover elsewhere</option>
          <option value="No longer need cover">No longer need cover</option>
          <option value="Price too high">Price too high</option>
          <option value="Taking too long">Taking too long</option>
          <option value="Made a mistake in my request">Made a mistake in my request</option>
        </Select>
        <p className="text-xs text-subtle">Cancelling stops quote preparation. It doesn&apos;t affect any policy you already have.</p>
        <FormMessage state={state} />
        <SubmitButton variant="outline" size="sm" pendingText="Cancelling…">Yes, cancel request</SubmitButton>
      </form>
    </details>
  );
}
