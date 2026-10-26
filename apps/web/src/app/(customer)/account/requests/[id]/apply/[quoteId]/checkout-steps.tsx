"use client";
import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Copy, CreditCard, Smartphone } from "lucide-react";
import { PAYMENT_STATUS, formatGHS, type FeeBreakdown, type PaymentStatus } from "@im/core";
import { FeeBreakdownBlock } from "@/components/customer/fee-breakdown";
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
  feeBreakdown,
}: {
  requestId: string;
  quoteId: string;
  declarations: Declaration[];
  benefits: { key: string; label: string; premium?: number }[];
  premium: number;
  insurer: string;
  termsVersion: string;
  feeBreakdown?: FeeBreakdown | null;
}) {
  const [state, action] = useActionState(submitApplication, initialActionState);
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [ticked, setTicked] = React.useState<Record<string, boolean>>({});
  const extra = benefits.filter((b) => chosen.includes(b.key)).reduce((s, b) => s + (b.premium ?? 0), 0);
  const fe = state.fieldErrors ?? {};
  const total = declarations.length + 1; // the declarations plus the terms acceptance
  const done = declarations.filter((d) => ticked[d.key]).length + (ticked.accept_terms ? 1 : 0);
  const allDone = done === total;

  return (
    <form action={action} className="space-y-7">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="quoteId" value={quoteId} />
      <fieldset className="space-y-3">
        <legend className="mb-1 text-h4 text-ink">Your declarations</legend>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">Tick each statement that is true. If any isn&apos;t, message your broker before applying.</p>
          <p className="rounded-full bg-mist px-3 py-1 text-[13px] font-medium tabular-nums text-ink-2" aria-live="polite">{done} of {total} done</p>
        </div>
        {declarations.map((d) => (
          <div key={d.key}>
            <label
              className={cn(
                "flex min-h-16 cursor-pointer items-start gap-3 rounded-card border bg-white p-4 text-[15px] leading-relaxed text-ink-2 transition-colors has-[:checked]:border-brand has-[:checked]:bg-mint/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                fe[`decl_${d.key}`] ? "border-danger" : "border-line",
              )}
            >
              <input
                type="checkbox"
                name={`decl_${d.key}`}
                checked={!!ticked[d.key]}
                onChange={(e) => setTicked((t) => ({ ...t, [d.key]: e.target.checked }))}
                className="mt-1 size-5 shrink-0 accent-brand"
              />
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
            <label key={b.key} className="flex cursor-pointer items-center gap-3 rounded-card border border-line p-4 text-sm has-[:checked]:border-brand">
              <input
                type="checkbox"
                name="benefits"
                value={b.key}
                className="size-5 accent-brand"
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
          <span className="text-2xl font-semibold text-ink">{formatGHS(premium + extra)}</span>
        </div>
        <p className="mt-1 text-xs text-muted">The insurer confirms the final amount. Optional benefits may be confirmed by your broker.</p>
        <FeeBreakdownBlock breakdown={feeBreakdown} className="mt-3" />
      </div>

      <div>
        <label className={cn("flex min-h-16 cursor-pointer items-start gap-3 rounded-card border bg-white p-4 text-[15px] leading-relaxed text-ink-2 has-[:checked]:border-brand has-[:checked]:bg-mint/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", fe.accept_terms ? "border-danger" : "border-line")}>
          <input type="checkbox" name="accept_terms" checked={!!ticked.accept_terms} onChange={(e) => setTicked((t) => ({ ...t, accept_terms: e.target.checked }))} className="mt-1 size-5 shrink-0 accent-brand" />
          <span>
            I accept the {insurer} policy wording and the platform terms (version {termsVersion}). I understand cover starts only when {insurer} confirms
            acceptance and issues my documents.
          </span>
        </label>
        {fe.accept_terms && <p className="mt-1 text-xs text-danger">{fe.accept_terms}</p>}
      </div>
      <FormMessage state={state} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-subtle">Payment does not make cover active until the insurer accepts.</p>
        <SubmitButton size="lg" disabled={!allDone} pendingText="Submitting…">
          {allDone ? "Continue to payment" : `Continue (${done} of ${total} done)`}
        </SubmitButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
const METHODS = [
  { value: "mtn", label: "MTN Mobile Money", short: "MTN MoMo", icon: Smartphone },
  { value: "vod", label: "Telecel Cash", short: "Telecel", icon: Smartphone },
  { value: "atl", label: "AirtelTigo Money", short: "AirtelTigo", icon: Smartphone },
  { value: "card", label: "Debit or credit card", short: "Card", icon: CreditCard },
  { value: "bank_transfer", label: "Bank transfer", short: "Bank", icon: Building2 },
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
        <h2 className="text-h4 text-ink">Pay {insurer}</h2>
        <p className="mt-1 text-[15px] text-muted">
          Secure checkout by Paystack. You pay the insurer directly through an authorised payment provider — we never hold your premium.
        </p>
      </div>
      {failure && <Notice tone="danger" title="Your last payment didn't go through">{failure} No cover has started. You can try again.</Notice>}
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">How would you like to pay?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {METHODS.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex min-h-16 cursor-pointer items-center gap-3 rounded-card border bg-white p-4 text-[15px] font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                method === m.value ? "border-brand bg-mint/40 text-brand-deep" : "border-line text-ink-2 hover:bg-mist",
              )}
            >
              <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="sr-only" />
              <m.icon aria-hidden className="size-5" />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      {method === "card" ? (
        <p className="text-sm text-muted">You&apos;ll be taken to the payment provider&apos;s secure page to enter your card details.</p>
      ) : method === "bank_transfer" ? (
        <p className="text-sm text-muted">We&apos;ll show you the insurer&apos;s account details and a reference to quote. Your payment shows as pending until the transfer is confirmed.</p>
      ) : (
        <Field label="Mobile money number" htmlFor="phone" error={fe.phone} hint="You'll get a prompt on this phone to approve the payment with your PIN.">
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={defaultPhone} placeholder="024 123 4567" aria-invalid={!!fe.phone} />
        </Field>
      )}
      <div className="rounded-card border border-line bg-mist p-4 sm:p-5">
        <p className="text-sm font-semibold text-ink">Order summary</p>
        <dl className="mt-2 divide-y divide-line text-sm">
          <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Insurer</dt><dd className="font-medium text-ink">{insurer}</dd></div>
          <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Pay with</dt><dd className="font-medium text-ink">{METHODS.find((m) => m.value === method)?.label}</dd></div>
          <div className="flex items-baseline justify-between gap-4 py-2"><dt className="text-muted">Amount due to {insurer}</dt><dd className="text-2xl font-semibold text-ink">{formatGHS(amount)}</dd></div>
        </dl>
      </div>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full sm:w-auto" pendingText="Starting payment…">
        Pay {formatGHS(amount)}
      </SubmitButton>
      <p className="text-[13px] text-subtle">Payment does not make cover active until the insurer accepts. Your cover starts once {insurer} confirms acceptance and issues your documents.</p>
    </form>
  );
}

// ---------------------------------------------------------------------------
export interface BankTransferDetail { bank: string; accountName: string; accountNumber: string; reference: string; amount: number; currency: string; kind: "insurer_account" | "paystack_dva"; instructions: string }

/** Bank transfer: the insurer's account (or a dedicated virtual account) and the reference to quote. */
export function BankTransferPanel({ detail, requestId, retryHref }: { detail: BankTransferDetail; requestId: string; retryHref: string }) {
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };
  const rows = [
    { label: "Bank", value: detail.bank },
    { label: "Account name", value: detail.accountName },
    { label: "Account number", value: detail.accountNumber },
    { label: "Amount", value: `${detail.currency} ${detail.amount.toFixed(2)}` },
    { label: "Reference", value: detail.reference },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-ink">Pay by bank transfer</h2>
        <p className="mt-1 text-[15px] text-muted">
          {detail.kind === "paystack_dva"
            ? "This account number is unique to you. Transfer the exact amount and we confirm it automatically — usually within minutes."
            : "Transfer the exact amount to the insurer's account below and quote the reference. The insurer confirms the credit, usually within one working day."}
        </p>
      </div>
      <dl className="divide-y divide-line rounded-card border border-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <dt className="text-muted">{r.label}</dt>
            <dd className="flex items-center gap-2 font-medium text-ink">
              <span className={r.label === "Reference" || r.label === "Account number" ? "font-mono" : ""}>{r.value}</span>
              {(r.label === "Reference" || r.label === "Account number") && (
                <button type="button" onClick={() => copy(r.label, r.value)} aria-label={`Copy ${r.label.toLowerCase()}`} className="rounded p-1 text-brand hover:bg-mist">
                  <Copy aria-hidden className="size-4" />
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p aria-live="polite" className={copied ? "text-xs text-ink-2" : "sr-only"}>{copied ? `${copied} copied.` : ""}</p>
      <Notice tone="wait" title="Pending until the transfer is confirmed">
        Your application is saved. We&apos;ll notify you when the payment is confirmed; no cover starts until the insurer accepts your application and issues documents.
      </Notice>
      <div className="flex flex-wrap gap-3">
        <Link href={`/account/requests/${requestId}`} className={buttonClass("primary")}>Back to request</Link>
        <Link href={retryHref} className={buttonClass("secondary")}>Use a different payment method</Link>
      </div>
    </div>
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
