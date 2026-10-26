"use client";
import * as React from "react";
import { useActionState } from "react";
import { CircleCheck, MessageSquare, Send } from "lucide-react";
import { formatDateTime, type ConsentKind } from "@im/core";
import { Button, Card, Field, Input, Pill, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";
import { confirmConsentCode, requestConsent } from "../../actions";

export interface ConsentState {
  kind: ConsentKind;
  granted: boolean;
  grantedAt: string | null;
  declinedAt: string | null;
  requestedAt: string | null;
  expiresAt: string | null;
  locked: boolean;
  channel: string | null;
}

/**
 * Send a consent code by SMS/WhatsApp, then enter the code the beneficiary reads out. The code never
 * reaches the sponsor's screen; only the beneficiary's phone.
 */
export function ConsentPanel({ beneficiaryId, beneficiaryName, kind, title, summary, state, codeLive, disabled }: { beneficiaryId: string; beneficiaryName: string; kind: ConsentKind; title: string; summary: string; state: ConsentState; /** A code was sent, is unexpired and not locked (computed server-side). */ codeLive: boolean; disabled?: boolean }) {
  const [sending, startSending] = React.useTransition();
  const [sendResult, setSendResult] = React.useState<ActionState | null>(null);
  const [channel, setChannel] = React.useState<"sms" | "whatsapp">("sms");
  const [confirmState, confirmAction] = useActionState(confirmConsentCode, initialActionState);
  const pending = !state.granted && !!state.requestedAt && !!state.expiresAt;
  const [showCode, setShowCode] = React.useState(codeLive);

  function send() {
    startSending(async () => {
      const r = await requestConsent(beneficiaryId, kind, channel);
      setSendResult(r);
      if (r.ok) setShowCode(true);
    });
  }

  return (
    <Card className={cn("p-4 sm:p-5", disabled && "opacity-70")} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-sm text-muted">{summary}</p>
        </div>
        {state.granted ? (
          <Pill tone="ok"><CircleCheck aria-hidden className="mr-1 inline size-3" />Given{state.grantedAt ? ` ${formatDateTime(state.grantedAt)}` : ""}</Pill>
        ) : state.declinedAt ? (
          <Pill tone="danger">Declined</Pill>
        ) : pending ? (
          <Pill tone={codeLive ? "wait" : "neutral"}>{state.locked ? "Locked — send a new code" : codeLive ? "Code sent" : "Code expired"}</Pill>
        ) : (
          <Pill tone="neutral">Not asked yet</Pill>
        )}
      </div>

      {!state.granted && !disabled && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <fieldset className="flex gap-2" aria-label="Send the code by">
              {(["sms", "whatsapp"] as const).map((c) => (
                <label key={c} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", channel === c ? "border-brand bg-mint-2 text-brand-deep" : "border-line text-ink-2 hover:bg-mist")}>
                  <input type="radio" name={`channel-${kind}`} value={c} checked={channel === c} onChange={() => setChannel(c)} className="sr-only" />
                  {c === "sms" ? <MessageSquare aria-hidden className="size-3.5" /> : <Send aria-hidden className="size-3.5" />}
                  {c === "sms" ? "SMS" : "WhatsApp"}
                </label>
              ))}
            </fieldset>
            <Button type="button" variant={pending ? "secondary" : "primary"} size="sm" loading={sending} onClick={send}>
              {pending ? "Send a new code" : `Send consent code to ${beneficiaryName}`}
            </Button>
          </div>
          <FormMessage state={sendResult ?? undefined} />

          {(showCode || pending) && (
            <form action={confirmAction} className="rounded-card border border-line bg-mist/40 p-4" noValidate>
              <input type="hidden" name="beneficiary_id" value={beneficiaryId} />
              <input type="hidden" name="kind" value={kind} />
              <Field label={`Enter the 6-digit code ${beneficiaryName} reads out`} htmlFor={`code-${kind}`} error={confirmState.fieldErrors?.code} hint="5 attempts. The code is valid for 15 minutes.">
                <div className="flex flex-wrap gap-2">
                  <Input id={`code-${kind}`} name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" placeholder="123456" className="max-w-[10rem] tracking-[0.3em]" aria-invalid={!!confirmState.fieldErrors?.code} />
                  <SubmitButton size="md" pendingText="Checking…">Confirm consent</SubmitButton>
                </div>
              </Field>
              <FormMessage state={confirmState} className="mt-3" />
            </form>
          )}
        </div>
      )}
      {disabled && !state.granted && <p className="mt-3 text-xs text-subtle">Available once {beneficiaryName} has agreed to share their details.</p>}
    </Card>
  );
}
