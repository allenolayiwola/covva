"use client";
import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, Smartphone } from "lucide-react";
import { PAYMENT_STATUS, formatGHS, type PaymentStatus } from "@im/core";
import { Button, Checkbox, DisclosureBlock, Field, Input, Notice, Spinner, buttonClass, cn } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { acknowledgeDisclosure, startPayment, submitApplication } from "./actions";
import type { Declaration } from "./declarations";

// ---------------------------------------------------------------------------
export function DisclosureStep({ requestId, quoteId, text, brokerName }: { requestId: string; quoteId: string; text: string; brokerName: string }) {
  const [state, action] = useActionState(acknowledgeDisclosure, initialActionState);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="quoteId" value={quoteId} />
      <div>
        <h2 className="text-xl font-semibold text-ink">Before you apply: who provides what</h2>
        <p className="mt-1 text-[15px] text-muted">
          {brokerName} is your broker of record for this request. They advise you and arrange the cover. The insurer accepts the risk, issues the
          policy and decides claims. We provide the technology only.
        </p>
      </div>
      <DisclosureBlock text={text} className="text-[14px]" />
      <ul className="space-y-1.5 text-sm text-ink-2">
        <li>• Your premium is paid through an authorised payment provider directly to the insurer — never to us.</li>
        <li>• Your broker may receive commission from the insurer. You can ask them how much.</li>
        <li>• If something goes wrong you can complain to your broker, the insurer, or the National Insurance Commission.</li>
      </ul>
      <Checkbox name="ack" required label={<span className="font-medium text-ink">I understand who provides what.</span>} />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Saving…">Continue</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function DeclarationsStep({
  requestId,
  quoteId,
  declarations,
  benefits,
  premium,
  insurer,
  termsVersion,
}: {
  requestId: string;
  quoteId: string;
  declarations: Declaration[];
  benefits: { key: string; label: string; premium?: number }[];
  premium: number;
  insurer: string;
  termsVersion: string;
}) {
  const [state, action] = useActionState(submitApplication, initialActionState);
  const [chosen, setChosen] = React.useState<string[]>([]);
  const extra = benefits.filter((b) => chosen.includes(b.key)).reduce((s, b) => s + (b.premium ?? 0), 0);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="quoteId" value={quoteId} />
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xl font-semibold text-ink">Your declarations</legend>
        <p className="text-sm text-muted">Please read each one. If any isn&apos;t true, message your broker before applying.</p>
        {declarations.map((d) => (
          <div key={d.key}>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm text-ink-2 has-[:checked]:border-brand has-[:checked]:bg-mint-2/50", fe[`decl_${d.key}`] ? "border-danger" : "border-line")}>
              <input type="checkbox" name={`decl_${d.key}`} className="mt-0.5 size-4 shrink-0 accent-brand" />
              <span>{d.text}</span>
            </label>
            {fe[`decl_${d.key}`] && <p className="mt-1 text-xs text-danger">{fe[`decl_${d.key}`]}</p>}
          </div>
        ))}
      </fieldset>

      {benefits.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-lg font-semibold text-ink">Optional benefits</legend>
          {benefits.map((b) => (
            <label key={b.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-4 text-sm has-[:checked]:border-brand">
              <input
                type="checkbox"
                name="benefits"
                value={b.key}
                className="size-4 accent-brand"
                checked={chosen.includes(b.key)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, b.key] : c.filter((x) => x !== b.key)))}
              />
              <span className="flex-1 text-ink">{b.label}</span>
              {b.premium ? <span className="font-medium text-ink">+{formatGHS(b.premium)}</span> : null}
            </label>
          ))}
        </fieldset>
      )}

      <div className="rounded-card bg-mist p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Premium{extra ? " incl. optional benefits" : ""}</span>
          <span className="text-2xl font-bold text-ink">{formatGHS(premium + extra)}</span>
        </div>
        <p className="mt-1 text-xs text-muted">The insurer confirms the final amount. Optional benefits may be confirmed by your broker.</p>
      </div>

      <div>
        <Checkbox
          name="accept_terms"
          label={
            <span>
              I accept the {insurer} policy wording and the platform terms (version {termsVersion}). I understand cover starts only when {insurer} confirms
              acceptance and issues my documents.
            </span>
          }
        />
        {fe.accept_terms && <p className="mt-1 text-xs text-danger">{fe.accept_terms}</p>}
      </div>
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Submitting…">Submit application</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
const METHODS = [
  { value: "mtn", label: "MTN Mobile Money", short: "MTN MoMo", icon: Smartphone },
  { value: "vod", label: "Telecel Cash", short: "Telecel", icon: Smartphone },
  { value: "atl", label: "AirtelTigo Money", short: "AirtelTigo", icon: Smartphone },
  { value: "card", label: "Debit or credit card", short: "Card", icon: CreditCard },
] as const;

export function PaymentStep({
  requestId,
  quoteId,
  applicationId,
  amount,
  insurer,
  defaultPhone,
  failure,
}: {
  requestId: string;
  quoteId: string;
  applicationId: string;
  amount: number;
  insurer: string;
  defaultPhone: string;
  failure?: string | null;
}) {
  const [state, action] = useActionState(startPayment, initialActionState);
  const [method, setMethod] = React.useState<string>("mtn");
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <div>
        <h2 className="text-xl font-semibold text-ink">Pay {insurer}</h2>
        <p className="mt-1 text-[15px] text-muted">
          You pay the insurer directly through an authorised payment provider. We never hold your premium.
        </p>
      </div>
      {failure && <Notice tone="danger" title="Your last payment didn't go through">{failure} No cover has started. You can try again.</Notice>}
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">How would you like to pay?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {METHODS.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                method === m.value ? "border-brand bg-mint-2 text-brand-deep" : "border-line text-ink-2 hover:bg-mist",
              )}
            >
              <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="sr-only" />
              <m.icon aria-hidden className="size-5" />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      {method !== "card" ? (
        <Field label="Mobile money number" htmlFor="phone" error={fe.phone} hint="You'll get a prompt on this phone to approve the payment with your PIN.">
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={defaultPhone} placeholder="024 123 4567" aria-invalid={!!fe.phone} />
        </Field>
      ) : (
        <p className="text-sm text-muted">You&apos;ll be taken to the payment provider&apos;s secure page to enter your card details.</p>
      )}
      <div className="flex items-baseline justify-between rounded-card bg-mist p-4">
        <span className="text-sm text-muted">Amount due to {insurer}</span>
        <span className="text-2xl font-bold text-ink">{formatGHS(amount)}</span>
      </div>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full sm:w-auto" pendingText="Starting payment…">
        Pay {formatGHS(amount)}
      </SubmitButton>
      <p className="text-xs text-subtle">Paying does not activate cover on its own. Your cover starts once {insurer} confirms acceptance and issues your documents.</p>
    </form>
  );
}

// ---------------------------------------------------------------------------
/** "Approve the prompt on your phone" — polls the payment row (RLS: own payments) until it settles. */
export function PaymentWaiting({ paymentId, requestId, retryHref }: { paymentId: string; requestId: string; retryHref: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<PaymentStatus | "unknown">("pending");
  const [reason, setReason] = React.useState<string | null>(null);
  const [timedOut, setTimedOut] = React.useState(false);

  React.useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let tries = 0;
    async function tick() {
      if (stopped) return;
      tries++;
      const { data } = await supabase.from("payments").select("status, failure_reason").eq("id", paymentId).maybeSingle();
      if (data) {
        setStatus(data.status);
        setReason(data.failure_reason);
        if (data.status === "succeeded") {
          router.replace(`/account/requests/${requestId}/confirmation`);
          return;
        }
        if (["failed", "abandoned", "reversed", "refunded"].includes(data.status)) return;
      } else if (tries > 3) {
        setStatus("unknown");
      }
      if (tries > 75) {
        setTimedOut(true);
        return;
      }
      setTimeout(tick, 4000);
    }
    void tick();
    return () => {
      stopped = true;
    };
  }, [paymentId, requestId, router]);

  const failed = ["failed", "abandoned", "reversed", "refunded"].includes(status);
  return (
    <div className="space-y-5 text-center" aria-live="polite">
      {!failed && !timedOut && (
        <>
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-mint text-brand">
            <Smartphone aria-hidden className="size-7" />
          </span>
          <div>
            <h2 className="text-2xl font-semibold text-ink">Approve the prompt on your phone</h2>
            <p className="mx-auto mt-1 max-w-md text-[15px] text-muted">
              Enter your mobile money PIN to approve the payment. Keep this page open — it updates by itself.
            </p>
          </div>
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" /> {status === "unknown" ? "Waiting for the payment provider…" : PAYMENT_STATUS[status as PaymentStatus]?.label ?? "Waiting…"}
          </p>
          <p className="text-xs text-subtle">No prompt? Check your phone has signal and enough balance, or dial your network&apos;s MoMo menu to approve pending payments.</p>
        </>
      )}
      {failed && (
        <Notice tone="danger" title="Payment not completed" className="text-left">
          {reason ?? "The payment was declined or cancelled."} No cover has started and no premium was taken.
        </Notice>
      )}
      {timedOut && !failed && (
        <Notice tone="wait" title="Still waiting for confirmation" className="text-left">
          We haven&apos;t heard back from the payment provider yet. If you approved the payment, we&apos;ll update your request automatically — you can leave
          this page.
        </Notice>
      )}
      {(failed || timedOut) && (
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={retryHref} className={buttonClass("primary")}>Try again</Link>
          <Link href={`/account/requests/${requestId}`} className={buttonClass("secondary")}>Back to request</Link>
        </div>
      )}
      {!failed && !timedOut && (
        <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(retryHref)}>
          Use a different payment method
        </Button>
      )}
    </div>
  );
}
