"use client";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { acceptInvitation } from "./actions";

export function AcceptForm({ token, orgName }: { token: string; orgName: string }) {
  const [state, action] = useActionState(acceptInvitation, initialActionState);
  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Joining…">Accept and join {orgName}</SubmitButton>
    </form>
  );
}
