"use client";
import { useActionState } from "react";
import { Field, Input, Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";

export function InspectionRequestForm({ action }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="mt-4 space-y-3">
      <Field label="Site address or landmark" htmlFor="insp-address" error={fe.address} hint="Where the partner should go, e.g. “Plot 12, Ahodwo, Kumasi — opposite the blue kiosk”.">
        <Input id="insp-address" name="address" required maxLength={500} aria-invalid={!!fe.address} />
      </Field>
      <Field label="Anything the inspector should know (optional)" htmlFor="insp-notes">
        <Textarea id="insp-notes" name="notes" rows={2} maxLength={2000} placeholder="Caretaker's phone, stage of construction, access hours…" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="sm" variant="secondary" pendingText="Requesting…">Request an inspection</SubmitButton>
    </form>
  );
}
