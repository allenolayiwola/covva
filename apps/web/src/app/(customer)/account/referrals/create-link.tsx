"use client";
import { useActionState } from "react";
import { Button } from "@im/ui";
import { createMyLink } from "./actions";

export function CreateLinkButton() {
  const [state, action, pending] = useActionState(createMyLink, null);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" loading={pending}>Get my referral link</Button>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}
