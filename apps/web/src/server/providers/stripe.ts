import "server-only";
import { unsupported, type PaymentProvider } from "./payment-provider";
import { paymentConfig } from "@/server/env";
import { verifyStripeSignature as checkSignature } from "./signatures";
import { log } from "@/server/log";

/**
 * Stripe adapter STUB for true multi-currency card payments (GBP/USD/EUR/CAD PaymentIntents /
 * Checkout Sessions in the payer's currency, Apple Pay and Google Pay included).
 *
 * OFF BY DEFAULT (`DIASPORA_PSP=paystack_intl`). Stripe settles to Covva's own Stripe balance in the
 * display currency, which Covva would then have to convert and pay on to the insurer: the PSP would
 * receive foreign currency BEFORE the insurer is paid. That is a collection-on-behalf arrangement and
 * conflicts with "Covva never holds client funds" unless structured and approved — it needs a legal
 * review (docs/OPERATIONS.md → Diaspora payments). Until `STRIPE_SETTLEMENT_APPROVED=true` is set
 * alongside the keys, `initiatePayment` keeps using Paystack international cards (settles GHS to the
 * insurer's subaccount) even when `DIASPORA_PSP=stripe`.
 *
 *   STRIPE_SECRET_KEY          — sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET      — whsec_… for /api/webhooks/stripe
 *   STRIPE_SETTLEMENT_APPROVED — "true" only after the legal view and the settlement set-up exist
 */
const STRIPE = "https://api.stripe.com/v1";

export const stripeKey = () => paymentConfig().provider === "stripe" ? process.env.STRIPE_SECRET_KEY || null : null;
export const stripeEnabled = () => !!stripeKey();
export const stripeSettlementApproved = () => process.env.STRIPE_SETTLEMENT_APPROVED === "true";

/** Stripe's API takes form-encoded bodies; nested objects use bracket notation. */
function encode(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(typeof item === "object" && item ? encode(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])));
    else if (typeof v === "object") out.push(...encode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function stripe<T>(path: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<{ ok: boolean; status: number; data?: T; message?: string }> {
  const key = stripeKey();
  if (!key) return { ok: false, status: 0, message: "STRIPE_SECRET_KEY is not set" };
  const res = await fetch(`${STRIPE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: encode(body).join("&"),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) return { ok: false, status: res.status, message: json.error?.message ?? `Stripe returned ${res.status}` };
  return { ok: true, status: res.status, data: json };
}

export interface StripeCheckoutInput {
  /** Minor units of `currency` (pence, cents). */
  amountMinor: number;
  currency: "gbp" | "usd" | "eur" | "cad";
  reference: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

/**
 * Hosted Checkout Session in the payer's currency (cards, Apple Pay and Google Pay are enabled by
 * Stripe automatically for `payment_method_types: card` on a hosted page). Returns the hosted URL.
 */
export async function stripeCreateCheckoutSession(input: StripeCheckoutInput): Promise<{ ok: boolean; url?: string; sessionId?: string; message?: string }> {
  if (!stripeSettlementApproved()) throw new Error("Stripe settlement approval is required.");
  const r = await stripe<{ id: string; url: string }>(
    "/checkout/sessions",
    {
      mode: "payment",
      client_reference_id: input.reference,
      customer_email: input.customerEmail,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      payment_method_types: ["card"],
      line_items: [{ quantity: 1, price_data: { currency: input.currency, unit_amount: input.amountMinor, product_data: { name: input.description } } }],
      payment_intent_data: { metadata: { ...input.metadata, reference: input.reference } },
      metadata: { ...input.metadata, reference: input.reference },
    },
    `checkout:${input.reference}`,
  );
  if (!r.ok || !r.data?.url) {
    log.error("stripe.checkout_failed", { status: r.status, message: r.message, reference: input.reference });
    return { ok: false, message: r.message };
  }
  return { ok: true, url: r.data.url, sessionId: r.data.id };
}

/** Stripe-Signature: `t=<ts>,v1=<hmac>`; HMAC-SHA256 of `<ts>.<raw body>` with the webhook secret. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSeconds = 300): boolean {
  return checkSignature(rawBody, header, secret, toleranceSeconds);
}

/** Stripe settlement remains unimplemented; approval alone cannot enable collection. */
export const stripeProvider: PaymentProvider = {
  name: 'stripe',
  async initialise() { return unsupported('Stripe insurer settlement'); },
  async verify() { return unsupported('Stripe insurer settlement verification'); },
  async refund() { return unsupported('Stripe insurer refunds'); },
  settlement() { return unsupported('Stripe insurer split/subaccounts'); },
  verifyWebhook: (raw, signature) => stripeEnabled() && verifyStripeSignature(raw, signature),
};
