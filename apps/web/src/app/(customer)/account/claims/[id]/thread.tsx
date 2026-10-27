"use client";
import * as React from "react";
import { useActionState } from "react";
import { Field, Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { MultiUpload } from "@/components/customer/upload";
import { initialActionState } from "@/components/customer/utils";
import { answerInfoRequest, sendClaimMessage } from "../actions";

/** Composer for the claim thread (attachments become claim documents). */
export function ClaimMessageComposer({ claimId, userId }: { claimId: string; userId: string }) {
  const [state, action] = useActionState(sendClaimMessage, initialActionState);
  const ref = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="claimId" value={claimId} />
      <Field label="Message your broker and the insurer" htmlFor="claim-msg" error={state.fieldErrors?.body}>
        <Textarea id="claim-msg" name="body" rows={3} maxLength={4000} className="min-h-20" placeholder="Ask a question or add information about the claim" />
      </Field>
      <MultiUpload userId={userId} scope="claims" name="attachments" label="Attach files (optional)" max={5} />
      <FormMessage state={state} />
      <SubmitButton size="md" pendingText="Sending…">Send message</SubmitButton>
    </form>
  );
}

/** Written reply to an information request. */
export function InfoRequestReply({ claimId, requestId }: { claimId: string; requestId: string }) {
  const [state, action] = useActionState(answerInfoRequest, initialActionState);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor={`reply-${requestId}`} className="sr-only">Your reply</label>
      <Textarea id={`reply-${requestId}`} name="response" rows={2} maxLength={2000} className="min-h-16 text-sm" placeholder="Or reply in writing" />
      <FormMessage state={state} />
      <SubmitButton size="sm" variant="secondary" pendingText="Sending…">Send reply</SubmitButton>
    </form>
  );
}
