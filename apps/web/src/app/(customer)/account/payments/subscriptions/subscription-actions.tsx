"use client";
import { useActionState } from "react";
import { Button } from "@im/ui";
import { FormMessage } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";

type Bound = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Pause / resume / cancel buttons for one sponsor subscription (Server Actions bound to its id). */
export function SubscriptionActions({ status, pause, resume, cancel }: { status: string; pause: Bound; resume: Bound; cancel: Bound }) {
  const [pauseState, pauseAction, pausePending] = useActionState(pause, initialActionState);
  const [resumeState, resumeAction, resumePending] = useActionState(resume, initialActionState);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancel, initialActionState);
  const state = [cancelState, pauseState, resumeState].find((s) => s.error || s.message) ?? initialActionState;
  if (status === "cancelled") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "paused" ? (
        <form action={resumeAction}>
          <Button type="submit" size="sm" variant="secondary" loading={resumePending}>Resume</Button>
        </form>
      ) : (
        <form action={pauseAction}>
          <Button type="submit" size="sm" variant="secondary" loading={pausePending}>Pause</Button>
        </form>
      )}
      <form
        action={cancelAction}
        onSubmit={(e) => {
          if (!window.confirm("Cancel this recurring payment? Existing cover runs to its end date and no further premiums are collected.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="reason" value="Cancelled by the sponsor" />
        <Button type="submit" size="sm" variant="ghost" loading={cancelPending}>Cancel</Button>
      </form>
      <FormMessage state={state} className="basis-full" />
    </div>
  );
}
