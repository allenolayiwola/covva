"use client";
import * as React from "react";
import { useActionState } from "react";
import { Info } from "lucide-react";
import { PRIVACY_REQUEST_TYPES, PRIVACY_REQUEST_TYPE_LIST, type PrivacyRequestType } from "@im/core";
import { Button, Field, Notice, Textarea, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { submitPrivacyRequest, withdrawPrivacyRequest } from "./actions";

/** Choose a request type, optionally add a note, send. Open types are disabled (one open request per type). */
export function PrivacyRequestForm({ openTypes, dueDays }: { openTypes: PrivacyRequestType[]; dueDays: number }) {
  const [state, action] = useActionState(submitPrivacyRequest, initialActionState);
  const firstFree = PRIVACY_REQUEST_TYPE_LIST.find((t) => !openTypes.includes(t)) ?? "access";
  const [type, setType] = React.useState<PrivacyRequestType>(firstFree);
  const meta = PRIVACY_REQUEST_TYPES[type];
  const fe = state.fieldErrors ?? {};
  const formRef = React.useRef<HTMLFormElement>(null);

  // Clear the note after a successful send (DOM sync with the action result).
  React.useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-5" noValidate data-testid="privacy-request-form">
      <fieldset>
        <legend className="mb-3 text-[15px] font-semibold text-ink">What would you like us to do?</legend>
        <div className="grid gap-2.5">
          {PRIVACY_REQUEST_TYPE_LIST.map((t) => {
            const m = PRIVACY_REQUEST_TYPES[t];
            const open = openTypes.includes(t);
            const id = `privacy-type-${t}`;
            return (
              <label
                key={t}
                htmlFor={id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-start gap-3 rounded-card border px-4 py-3 transition-colors",
                  type === t ? "border-brand bg-mint-2/60" : "border-line hover:bg-mist",
                  open && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name="type"
                  value={t}
                  checked={type === t}
                  disabled={open}
                  onChange={() => setType(t)}
                  className="mt-1 size-5 shrink-0 accent-brand"
                  aria-describedby={`${id}-desc`}
                />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-ink">{m.customerLabel}</span>
                  <span id={`${id}-desc`} className="block text-sm text-muted">
                    {open ? "You already have an open request like this — see below." : m.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <Notice tone="info" icon={<Info aria-hidden className="size-4" />} title="What happens next">
        {meta.whatHappens}
        {type !== "marketing_opt_out" && ` We'll reply within ${dueDays} days at the latest.`}
      </Notice>

      <Field
        label={
          <>
            {meta.notePrompt.replace(/ \(optional\)$/, "")}
            {!meta.noteRequired && <span className="font-normal text-subtle"> (optional)</span>}
          </>
        }
        htmlFor="privacy-note"
        error={fe.note}
        hint="Please don't include card numbers or passwords."
      >
        <Textarea
          id="privacy-note"
          name="note"
          rows={4}
          maxLength={2000}
          required={meta.noteRequired}
          aria-invalid={!!fe.note}
          aria-describedby={fe.note ? "note-error" : undefined}
          className="min-h-28 text-[15px]"
        />
      </Field>

      <FormMessage state={state} />
      <SubmitButton className="min-h-11" pendingText="Sending…">
        {type === "marketing_opt_out" ? "Stop marketing now" : "Send request"}
      </SubmitButton>
    </form>
  );
}

export function WithdrawButton({ id }: { id: string }) {
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-10"
        loading={pending}
        onClick={() =>
          start(async () => {
            if (!window.confirm("Withdraw this request? You can make a new one at any time.")) return;
            const res = await withdrawPrivacyRequest(id);
            setMsg(res.ok ? null : res.error ?? "Something went wrong.");
          })
        }
      >
        Withdraw request
      </Button>
      {msg && (
        <span role="alert" className="text-[13px] text-danger">
          {msg}
        </span>
      )}
    </span>
  );
}
