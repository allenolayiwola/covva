"use client";
import { useActionState } from "react";
import { Button } from "@im/ui";
import { FormMessage } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";

type Bound = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function MethodActions({ isDefault, makeDefault, remove }: { isDefault: boolean; makeDefault: Bound; remove: Bound }) {
  const [defState, defAction, defPending] = useActionState(makeDefault, initialActionState);
  const [rmState, rmAction, rmPending] = useActionState(remove, initialActionState);
  const state = [rmState, defState].find((s) => s.error || s.message) ?? initialActionState;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isDefault && (
        <form action={defAction}>
          <Button type="submit" size="sm" variant="secondary" loading={defPending}>Make default</Button>
        </form>
      )}
      <form
        action={rmAction}
        onSubmit={(e) => {
          if (!window.confirm("Remove this card? Recurring payments that use it will pause until you add another card.")) e.preventDefault();
        }}
      >
        <Button type="submit" size="sm" variant="ghost" loading={rmPending}>Remove</Button>
      </form>
      <FormMessage state={state} className="basis-full" />
    </div>
  );
}
