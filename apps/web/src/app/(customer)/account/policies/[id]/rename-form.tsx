"use client";
import { useActionState } from "react";
import { Input } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";
import { renamePolicy } from "../actions";

export function RenameForm({ policyId, current }: { policyId: string; current: string }) {
  const [state, action] = useActionState(renamePolicy.bind(null, policyId) as (s: ActionState, f: FormData) => Promise<ActionState>, initialActionState);
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="nickname" className="block text-sm font-medium text-ink-2">Give this policy a name</label>
      <div className="flex gap-2">
        <Input id="nickname" name="nickname" defaultValue={current} maxLength={60} placeholder="e.g. Your everyday drive" />
        <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
