"use client";
import { useActionState } from "react";
import { Field, Input } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { updatePassword } from "../actions";

export function ResetPasswordForm({ email }: { email: string }) {
  const [state, action] = useActionState(updatePassword, initialActionState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {email && <p className="text-sm text-muted">For {email}</p>}
      <input type="text" name="username" autoComplete="username" defaultValue={email} className="sr-only" tabIndex={-1} aria-hidden readOnly />
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Saving…">Save password</SubmitButton>
    </form>
  );
}
