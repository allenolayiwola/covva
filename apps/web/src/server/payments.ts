import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { formatDate, formatMoney, instalmentAmount, parseDisplayCurrency, roundHalfUp, type FxQuote, type SubscriptionCadence } from "@im/core";
import type { Enum, Json, Row } from "@im/db";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError, ruleMessage } from "@/server/requests";
import { notify, notifyOrg } from "@/server/notify";
import { log } from "@/server/log";
import { applePayEnabled, diasporaPsp, paystackKey, simulatorEnabled, simulatorSignature, siteUrl } from "@/server/env";
import { emitEvent, emitRequestStatus } from "@/server/webhooks";
import { persistPaymentSplits, splitForPayment } from "@/server/commercial";
import { recordPaymentLedger, recordRefundLedger } from "@/server/ledger";
import { hubtelEnabled, hubtelInitiate, hubtelVerify } from "@/server/providers/hubtel";
import { stripeEnabled, stripeSettlementApproved } from "@/server/providers/stripe";
import { quoteFx } from "@/server/fx";
import { savePaymentMethodFromOutcome } from "@/server/payment-methods";

/**
 * Payment service (owner: Backend stream). Premiums are paid through Paystack and
 * settle to the INSURER's subaccount — never to the platform.
 *
 * All writes here use the service client: `payments` has no insert policy (rows are
 * created only by trusted server code), and creating the pending policy after
 * payment is a system action. Authorisation is checked in code before any write.
 */
export interface InitiatePaymentResult {
  paymentId: string;
  reference: string;
  /** Hosted checkout URL (card / mobile money). Null when a mobile-money prompt was pushed directly. */
  authorizationUrl: string | null;
  status: Enum<"payment_status">;
  /** Provider instructions for direct mobile-money prompts (e.g. "Approve the prompt on your phone"). */
  displayText?: string | null;
  /** Which provider took the payment: paystack | hubtel | simulator | bank_transfer. */
  provider?: PaymentProvider;
  /** Bank transfer: where to send the money and the reference to quote. Null for other channels. */
  bankTransfer?: BankTransferInstructions | null;
  /**
   * Diaspora display (indicative): what the payer sees in their currency, the rate used and the
   * disclosure. `amount`/`currency` on the payment stay the GHS contract amount the insurer receives.
   */
  fx?: FxQuote | null;
  /** Which PSP takes the money: paystack_intl for foreign cards (settles GHS), else the provider. */
  psp?: Psp;
  /** Set when this first payment also starts a sponsor subscription (next collections are automatic). */
  sponsorSubscription?: { cadence: SubscriptionCadence; chargeAmount: number; quotedTotal: number } | null;
}

export type PaymentProvider = "paystack" | "hubtel" | "simulator" | "bank_transfer";
export type Psp = "paystack_intl" | "stripe" | PaymentProvider;

export interface BankTransferInstructions {
  bank: string;
  accountName: string;
  accountNumber: string;
  /** Unique reference the customer must quote on the transfer (matched at reconciliation). */
  reference: string;
  /** `insurer_account` = the insurer's own settlement account; `paystack_dva` = a Paystack dedicated virtual account (auto-confirms by webhook). */
  kind: "insurer_account" | "paystack_dva";
  amount: number;
  currency: string;
  instructions: string;
}

/**
 * Which hosted provider an insurer's payments go through: `organizations.settings.payment_provider`
 * wins, then `PAYMENT_PROVIDER` (default paystack). Hubtel is only used when its credentials are set.
 */
export function paymentProviderFor(insurerSettings: Json | null | undefined): "paystack" | "hubtel" {
  const org = (asObject(insurerSettings).payment_provider as string | undefined)?.toLowerCase();
  const wanted = org === "paystack" || org === "hubtel" ? org : (process.env.PAYMENT_PROVIDER ?? "paystack").toLowerCase();
  return wanted === "hubtel" && hubtelEnabled() ? "hubtel" : "paystack";
}

type Svc = ReturnType<typeof createServiceClient>;
type PaymentRow = Row<"payments">;

const PAYSTACK = "https://api.paystack.co";
const PAYMENT_DOCS_NEXT_STEP = "Payment received. Your cover starts once the insurer confirms acceptance and issues documents.";

async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function newReference() {
  return `IMP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function paystack<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ ok: boolean; status: number; json: { status?: boolean; message?: string; data?: T } }> {
  const res = await fetch(`${PAYSTACK}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${paystackKey()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  return { ok: res.ok && json.status !== false, status: res.status, json };
}

function toChannel(c: string | null | undefined): Enum<"payment_channel"> | null {
  switch (c) {
    case "mobile_money": return "mobile_money";
    case "card": return "card";
    case "bank":
    case "bank_transfer": return "bank_transfer";
    case "ussd": return "ussd";
    default: return null;
  }
}

function asObject(v: Json | null | undefined): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// initiatePayment
// ---------------------------------------------------------------------------
export async function initiatePayment(args: {
  applicationId: string;
  channel: "mobile_money" | "card" | "bank_transfer";
  /** For direct MoMo charge: E.164 phone and network. */
  momo?: { phone: string; provider: "mtn" | "vod" | "atl" };
  callbackUrl?: string;
  /**
   * Verified id of the paying customer (API v1 passes this from the bearer token).
   * When omitted the cookie session is used. The caller must own the application.
   */
  userId?: string;
  /** Diaspora: currency to DISPLAY the amount in (GHS, GBP, USD, EUR, CAD). The charge is still the GHS amount. */
  displayCurrency?: string | null;
  /** Card only: keep the PSP authorisation token (never the card number) for future sponsor collections. */
  saveMethod?: boolean;
  /** Sponsor abroad: this payment is the first instalment of a recurring collection (card only). */
  sponsorSubscription?: { cadence: SubscriptionCadence; beneficiaryId?: string | null } | null;
}): Promise<InitiatePaymentResult> {
  const svc = createServiceClient();

  const { data: app } = await svc
    .from("applications")
    .select("id, status, quote_id, request_id, customer_id, selected_benefits")
    .eq("id", args.applicationId)
    .maybeSingle();
  if (!app) throw new BusinessRuleError("Application not found.", "not_found");

  // Authorisation: only the customer who submitted the application can pay for it.
  const callerId = args.userId ?? (await currentUserId());
  if (!callerId) throw new BusinessRuleError("Please sign in to continue.", "unauthorised");
  if (callerId !== app.customer_id) throw new BusinessRuleError("Application not found.", "not_found");

  if (app.status !== "submitted" && app.status !== "accepted") {
    throw new BusinessRuleError("Submit your application before paying.");
  }

  const { data: quote } = await svc.from("quotes").select("*").eq("id", app.quote_id).single();
  if (!quote) throw new BusinessRuleError("Quote not found.", "not_found");
  // Checkout revalidation: only a live, binding quote can be paid for.
  if (quote.status !== "ready_to_accept") {
    throw new BusinessRuleError(`This quote can't be paid for (status: ${quote.status.replace(/_/g, " ")}). Ask your broker for an updated quote.`);
  }
  if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
    await svc.from("quotes").update({ status: "expired" }).eq("id", quote.id).eq("status", "ready_to_accept");
    throw new BusinessRuleError(`This quote expired on ${formatDate(quote.valid_until)}. Ask your broker to revalidate it before paying.`);
  }

  const { data: request } = await svc
    .from("requests")
    .select("id, reference, status, customer_id, broker_org_id, source_broker_org_id")
    .eq("id", app.request_id)
    .single();
  if (!request || request.customer_id !== callerId) throw new BusinessRuleError("Request not found.", "not_found");
  if (request.status !== "quotes_ready" && request.status !== "payment_confirmation") {
    throw new BusinessRuleError("This request isn't ready for payment.");
  }

  const { data: insurer } = await svc
    .from("organizations")
    .select("id, name, type, status, paystack_subaccount_code, paystack_split_code, settings")
    .eq("id", quote.insurer_org_id)
    .single();
  if (!insurer || insurer.type !== "insurer" || insurer.status !== "active") {
    throw new BusinessRuleError("This insurer can't accept payments right now.");
  }

  const idempotencyKey = `app:${app.id}`;
  const { data: existing } = await svc.from("payments").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing?.status === "succeeded") throw new BusinessRuleError("This application has already been paid.", "conflict");

  // A pending bank transfer keeps its instructions (the customer may take a day to pay).
  if (existing && existing.status === "pending" && existing.provider === "bank_transfer" && args.channel === "bank_transfer" && existing.channel_detail) {
    const bt = bankTransferFromDetail(existing);
    if (bt) return { paymentId: existing.id, reference: existing.provider_reference!, authorizationUrl: null, status: existing.status, displayText: bt.instructions, provider: "bank_transfer", bankTransfer: bt };
  }

  // Same live attempt (e.g. the app retried the call) → return it instead of starting another.
  if (
    existing &&
    (existing.status === "pending" || existing.status === "processing") &&
    existing.authorization_url &&
    existing.channel === args.channel &&
    !args.momo &&
    Date.now() - new Date(existing.updated_at).getTime() < 30 * 60_000
  ) {
    return { paymentId: existing.id, reference: existing.provider_reference!, authorizationUrl: existing.authorization_url, status: existing.status };
  }

  // Amount: premium + taxes + fees + selected optional benefits (from the quote, never from the client).
  const selected = new Set(Array.isArray(app.selected_benefits) ? (app.selected_benefits as unknown[]).map(String) : []);
  const benefits = (Array.isArray(quote.optional_benefits) ? quote.optional_benefits : []) as { key?: string; premium?: number }[];
  const benefitTotal = benefits.filter((b) => b.key && selected.has(b.key)).reduce((s, b) => s + (Number(b.premium) || 0), 0);
  let amount = Math.round((Number(quote.premium) + Number(quote.taxes) + Number(quote.fees) + benefitTotal) * 100) / 100;
  if (!(amount > 0)) throw new BusinessRuleError("The amount due could not be calculated.");
  const quotedTotal = amount;

  // Diaspora (roadmap Phase 2): display currency and sponsor instalments. Foreign currency is card only
  // (mobile money and bank transfers are GHS rails); a recurring sponsor plan needs a card authorisation.
  const displayCurrency = parseDisplayCurrency(args.displayCurrency) ?? "GHS";
  const sponsorPlan = args.sponsorSubscription ?? null;
  if (displayCurrency !== "GHS" && args.channel !== "card") throw new BusinessRuleError(`Paying in ${displayCurrency} is by card only. Mobile money and bank transfer are in Ghana cedis.`, "invalid_input");
  if (sponsorPlan && args.channel !== "card") throw new BusinessRuleError("Recurring sponsor payments need a card so the next premium can be collected automatically. Choose card, or pay once by mobile money.", "invalid_input");
  if (sponsorPlan) {
    if (sponsorPlan.cadence !== "annual" && quote.billing_period !== "month" && asObject(insurer.settings).instalments_allowed !== true) {
      throw new BusinessRuleError(`${insurer.name} prices this cover yearly. Choose "pay yearly as a sponsor" or ask your broker about instalments.`);
    }
    const annual = quote.billing_period === "month" ? amount * 12 : amount;
    amount = quote.billing_period === "month" && sponsorPlan.cadence === "monthly" ? amount : sponsorPlan.cadence === "annual" ? roundHalfUp(annual) : instalmentAmount(annual, sponsorPlan.cadence);
  }
  const fx = await quoteFx(amount, displayCurrency);
  if (displayCurrency !== "GHS" && diasporaPsp() === "stripe") {
    // Stripe would receive foreign currency before the insurer is paid: OFF until the legal view and
    // settlement set-up exist (docs/OPERATIONS.md). Paystack international cards settle GHS to the insurer.
    log.warn("stripe.not_used", { reason: !stripeEnabled() ? "no STRIPE_SECRET_KEY" : !stripeSettlementApproved() ? "STRIPE_SETTLEMENT_APPROVED is not true (legal review pending)" : "adapter not wired to settlement", fallback: "paystack_intl" });
  }

  const key = paystackKey();
  const insurerSettings = asObject(insurer.settings);
  let provider: PaymentProvider;
  let bankTransfer: BankTransferInstructions | null = null;
  const hubtelMerchant = typeof insurerSettings.hubtel_merchant_account === "string" ? insurerSettings.hubtel_merchant_account : process.env.HUBTEL_MERCHANT_ACCOUNT ?? null;
  if (args.channel === "bank_transfer") {
    // Bank transfer: money goes to the insurer's own account (or a Paystack dedicated virtual account);
    // the payment stays pending until the webhook / admin reconciliation confirms the credit.
    provider = "bank_transfer";
  } else if (paymentProviderFor(insurer.settings) === "hubtel") {
    if (!hubtelMerchant) {
      throw new BusinessRuleError(`${insurer.name}'s payment route isn't set up yet, so we can't take payment. Your broker will contact you.`);
    }
    provider = "hubtel";
  } else if (key) {
    if (!insurer.paystack_subaccount_code) {
      throw new BusinessRuleError(`${insurer.name}'s payment route isn't set up yet, so we can't take payment. Your broker will contact you.`);
    }
    provider = "paystack";
  } else if (simulatorEnabled()) {
    provider = "simulator";
  } else {
    throw new BusinessRuleError("Payments are temporarily unavailable. Please try again later.", "unavailable");
  }

  const { data: profile } = await svc.from("profiles").select("email, phone").eq("id", callerId).maybeSingle();
  const email = profile?.email ?? `customer-${callerId.slice(0, 8)}@payments.covva.com.gh`;
  const reference = newReference();
  const callbackUrl = args.callbackUrl ?? `${siteUrl()}/account/requests/${request.id}/confirmation`;
  const init = {
    callback_url: callbackUrl,
    channel: args.channel,
    momo_provider: args.momo?.provider ?? null,
    started_at: new Date().toISOString(),
    display_currency: displayCurrency,
    display_amount: fx.displayAmount,
    fx_disclosure: fx.disclosure,
    save_method: !!args.saveMethod || !!sponsorPlan,
    sponsor_subscription: sponsorPlan ? { cadence: sponsorPlan.cadence, beneficiary_id: sponsorPlan.beneficiaryId ?? null, quoted_total: quotedTotal, charge_amount: amount, billing_period: quote.billing_period } : null,
  };
  const psp: Psp = provider === "paystack" && displayCurrency !== "GHS" ? "paystack_intl" : provider;
  // Three-party split (insurer / broker commission / platform fee) — see server/commercial.ts.
  // Paystack settles one subaccount per transaction unless a split group is configured.
  // An instalment scales the quote's taxes and fees pro rata so commission stays a % of the net premium.
  const scale = amount / quotedTotal;
  const commercial = await splitForPayment(svc, { amount, quote: { ...quote, taxes: roundHalfUp(Number(quote.taxes) * scale), fees: roundHalfUp(Number(quote.fees) * scale) }, request, insurer, provider });
  if (provider === "bank_transfer") {
    bankTransfer = await bankTransferInstructions(svc, { insurer: { id: insurer.id, name: insurer.name, settings: insurer.settings }, customerId: callerId, email, reference, amount, currency: quote.currency });
  }

  const base = {
    application_id: app.id,
    request_id: request.id,
    quote_id: quote.id,
    customer_id: callerId,
    payee_org_id: insurer.id, // premiums settle to the insurer (trigger enforces insurer type)
    amount,
    currency: quote.currency,
    provider,
    psp,
    display_currency: displayCurrency,
    display_amount: fx.displayAmount,
    fx_rate: displayCurrency === "GHS" ? null : fx.rate,
    fx_source: displayCurrency === "GHS" ? null : fx.source,
    fx_quoted_at: displayCurrency === "GHS" ? null : fx.quotedAt,
    provider_reference: reference,
    channel: args.channel as Enum<"payment_channel">,
    status: "pending" as const,
    settlement_subaccount:
      provider === "hubtel" ? hubtelMerchant : provider === "bank_transfer" ? bankTransfer?.accountNumber ?? null : insurer.paystack_subaccount_code ?? (provider === "simulator" ? "SIMULATED" : null),
    authorization_url: null,
    failure_reason: null,
    channel_detail: bankTransfer ? ({ ...bankTransfer, kind: bankTransfer.kind } as unknown as Json) : null,
    raw_event: { initialize: init, split: commercial.summary } as unknown as Json,
  };

  let payment: PaymentRow;
  if (existing) {
    const { data, error } = await svc.from("payments").update(base).eq("id", existing.id).neq("status", "succeeded").select("*").single();
    if (error || !data) throw new BusinessRuleError("We couldn't start the payment. Please try again.");
    payment = data;
  } else {
    const { data, error } = await svc.from("payments").insert({ ...base, idempotency_key: idempotencyKey }).select("*").single();
    if (error?.code === "23505") throw new BusinessRuleError("A payment is already being set up for this application. Please try again in a moment.", "conflict");
    if (error?.code === "P0001") throw new BusinessRuleError(error.message);
    if (error || !data) throw new BusinessRuleError("We couldn't start the payment. Please try again.");
    payment = data;
  }

  await svc.from("quotes").update({ revalidated_at: new Date().toISOString() }).eq("id", quote.id);
  await persistPaymentSplits(svc, payment.id, commercial, base.settlement_subaccount);

  let authorizationUrl: string | null = null;
  let status: Enum<"payment_status"> = "pending";
  let displayText: string | null = null;
  const metadata = { payment_id: payment.id, application_id: app.id, request_id: request.id, quote_id: quote.id, request_reference: request.reference, display_currency: displayCurrency, display_amount: fx.displayAmount, psp };

  if (provider === "simulator") {
    authorizationUrl = `${siteUrl()}/api/payments/simulate?reference=${encodeURIComponent(reference)}&sig=${simulatorSignature(reference)}`;
  } else if (provider === "bank_transfer") {
    displayText = bankTransfer?.instructions ?? null;
  } else if (provider === "hubtel") {
    const res = await hubtelInitiate({
      amount,
      description: `Premium for ${request.reference} (${insurer.name})`,
      clientReference: reference,
      callbackUrl: `${siteUrl()}/api/webhooks/hubtel${process.env.HUBTEL_WEBHOOK_SECRET ? `?secret=${encodeURIComponent(process.env.HUBTEL_WEBHOOK_SECRET)}` : ""}`,
      returnUrl: callbackUrl,
      cancellationUrl: callbackUrl,
      customerPhone: args.momo?.phone ?? profile?.phone ?? null,
      customerEmail: email,
      merchantAccount: hubtelMerchant,
    });
    if (!res.ok || !res.checkoutUrl) {
      await markFailed(svc, payment, res.message ?? "Checkout could not be started", { initialize_error: res } as unknown as Json, false);
      log.error("hubtel.initialize_failed", { status: res.status, message: res.message, paymentId: payment.id });
      throw new BusinessRuleError("We couldn't start the payment. Please try again.");
    }
    authorizationUrl = res.checkoutUrl;
  } else if (args.channel === "mobile_money" && args.momo) {
    const res = await paystack<{ status?: string; display_text?: string; reference?: string }>("/charge", {
      method: "POST",
      body: {
        email,
        amount: Math.round(amount * 100), // pesewas
        currency: "GHS",
        reference,
        mobile_money: { phone: args.momo.phone, provider: args.momo.provider },
        ...commercial.paystackSettlement, // split group when configured, else the insurer's subaccount (bearer: subaccount)
        metadata,
      },
    });
    if (!res.ok) {
      await markFailed(svc, payment, res.json.message ?? "Mobile money prompt could not be sent", { charge: res.json } as Json, false);
      throw new BusinessRuleError(res.json.message ?? "We couldn't send the mobile money prompt. Check the number and try again.");
    }
    const st = res.json.data?.status;
    displayText = res.json.data?.display_text ?? "Approve the payment prompt on your phone.";
    status = st === "success" ? "succeeded" : st === "failed" ? "failed" : "processing";
  } else {
    const res = await paystack<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
      method: "POST",
      body: {
        email,
        amount: Math.round(amount * 100), // pesewas
        currency: "GHS",
        reference,
        callback_url: callbackUrl,
        // Foreign cards: Paystack charges the GHS amount and the issuer converts (settles GHS to the insurer).
        // Apple Pay / Google Pay ride on the hosted checkout when PAYSTACK_APPLE_PAY=true (enable on the business first).
        channels: args.channel === "card" && applePayEnabled() ? ["card", "apple_pay"] : [args.channel],
        ...commercial.paystackSettlement, // settle to the insurer (or the configured split group)
        metadata: { ...metadata, cancel_action: callbackUrl },
      },
    });
    if (!res.ok || !res.json.data?.authorization_url) {
      await markFailed(svc, payment, res.json.message ?? "Checkout could not be started", { initialize_error: res.json } as Json, false);
      log.error("paystack.initialize_failed", { status: res.status, message: res.json.message, paymentId: payment.id });
      throw new BusinessRuleError("We couldn't start the payment. Please try again.");
    }
    authorizationUrl = res.json.data.authorization_url;
  }

  await svc
    .from("payments")
    .update({ authorization_url: authorizationUrl, status: status === "succeeded" ? "processing" : status })
    .eq("id", payment.id)
    .neq("status", "succeeded");

  if (request.status === "quotes_ready") {
    await svc
      .from("requests")
      .update({ status: "payment_confirmation", next_step: "Complete your payment. Your cover is not active until the insurer issues your policy." })
      .eq("id", request.id)
      .eq("status", "quotes_ready");
  }
  await svc.from("request_events").insert({
    request_id: request.id,
    actor_id: callerId,
    actor_party: "customer",
    event: "payment_initiated",
    note: `Payment of ${quote.currency} ${amount.toFixed(2)} started (${provider === "simulator" ? "sandbox simulator" : provider === "hubtel" ? `Hubtel ${args.channel.replace(/_/g, " ")}` : args.channel.replace(/_/g, " ")})${displayCurrency !== "GHS" ? ` — shown as ≈ ${formatMoney(fx.displayAmount, displayCurrency)} (indicative)` : ""}${sponsorPlan ? ` as the first ${sponsorPlan.cadence} sponsor instalment` : ""}.`,
    data: { payment_id: payment.id, reference, provider, psp, display_currency: displayCurrency, display_amount: fx.displayAmount } as Json,
  });

  if (status === "succeeded") {
    // Direct charge confirmed synchronously — verify with the provider before applying.
    const v = await verifyPayment(reference);
    status = v.status;
  }
  return {
    paymentId: payment.id,
    reference,
    authorizationUrl,
    status,
    displayText,
    provider,
    bankTransfer,
    fx,
    psp,
    sponsorSubscription: sponsorPlan ? { cadence: sponsorPlan.cadence, chargeAmount: amount, quotedTotal } : null,
  };
}

/** A collection for a sponsor subscription (no application / request flow of its own). */
function isSubscriptionCharge(p: Pick<PaymentRow, "application_id" | "raw_event">): boolean {
  return p.application_id === null && typeof asObject(p.raw_event).subscription_id === "string";
}

/** The sponsor plan requested at initiation (`raw_event.initialize.sponsor_subscription`), if any. */
function sponsorPlanOf(p: Pick<PaymentRow, "raw_event">): { cadence: SubscriptionCadence } | null {
  const plan = asObject(asObject(asObject(p.raw_event).initialize as Json).sponsor_subscription as Json);
  const cadence = plan.cadence;
  return cadence === "monthly" || cadence === "quarterly" || cadence === "annual" ? { cadence } : null;
}

// ---------------------------------------------------------------------------
// Sponsor subscription collections (stored card authorisation)
// ---------------------------------------------------------------------------
/**
 * Collect one subscription instalment with the sponsor's saved method: a `payments` row in GHS with
 * the INSURER as payee (same split, ledger and settlement path as a checkout), charged through
 * Paystack `charge_authorization` (foreign cards settle GHS) or the sandbox simulator. The outcome
 * is applied through `applyPaymentResult` → `applySubscriptionChargeOutcome`.
 */
export async function chargeStoredMethod(args: {
  subscription: Row<"sponsor_subscriptions">;
  method: Row<"payment_methods"> | null;
  policy: { id: string; request_id: string | null; quote_id: string | null; customer_id: string; insurer_org_id: string; broker_org_id: string | null };
  attempt: number;
  chargeNo: number;
}): Promise<{ paymentId: string; reference: string; status: Enum<"payment_status"> }> {
  const svc = createServiceClient();
  const sub = args.subscription;
  if (!args.policy.request_id) throw new BusinessRuleError("This policy has no request to attach the collection to.");
  const [{ data: insurer }, { data: quote }, { data: request }] = await Promise.all([
    svc.from("organizations").select("id, name, type, status, paystack_subaccount_code, paystack_split_code, settings").eq("id", args.policy.insurer_org_id).single(),
    args.policy.quote_id ? svc.from("quotes").select("*").eq("id", args.policy.quote_id).maybeSingle() : Promise.resolve({ data: null }),
    svc.from("requests").select("id, reference, broker_org_id, source_broker_org_id").eq("id", args.policy.request_id).single(),
  ]);
  if (!insurer || insurer.type !== "insurer" || insurer.status !== "active") throw new BusinessRuleError("This insurer can't accept payments right now.");
  if (!request) throw new BusinessRuleError("Request not found.", "not_found");
  const amount = roundHalfUp(Number(sub.ghs_amount));
  if (!(amount > 0)) throw new BusinessRuleError("Nothing to collect.");

  let provider: PaymentProvider;
  if (args.method && args.method.psp.startsWith("paystack") && paystackKey()) {
    if (!insurer.paystack_subaccount_code) throw new BusinessRuleError(`${insurer.name}'s payment route isn't set up.`);
    provider = "paystack";
  } else if (simulatorEnabled() && (!args.method || args.method.psp === "simulator")) {
    provider = "simulator";
  } else {
    throw new BusinessRuleError("No usable payment route for this saved card.", "unavailable");
  }
  const psp: Psp = provider === "simulator" ? "simulator" : args.method?.psp === "paystack_intl" ? "paystack_intl" : "paystack";
  const fx = await quoteFx(amount, sub.display_currency);
  const idempotencyKey = `sub:${sub.id}:${args.chargeNo}:${args.attempt}`;
  const { data: existing } = await svc.from("payments").select("id, provider_reference, status").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) return { paymentId: existing.id, reference: existing.provider_reference ?? "", status: existing.status };

  const quotedTotal = quote ? Number(quote.premium) + Number(quote.taxes) + Number(quote.fees) : amount;
  const scale = quotedTotal > 0 ? amount / quotedTotal : 1;
  const quoteForSplit = quote
    ? { id: quote.id, premium: Number(quote.premium), taxes: roundHalfUp(Number(quote.taxes) * scale), fees: roundHalfUp(Number(quote.fees) * scale), currency: quote.currency, insurer_org_id: quote.insurer_org_id, broker_org_id: quote.broker_org_id }
    : { id: "", premium: amount, taxes: 0, fees: 0, currency: "GHS", insurer_org_id: insurer.id, broker_org_id: args.policy.broker_org_id };
  const commercial = await splitForPayment(svc, { amount, quote: quoteForSplit, request, insurer, provider });
  const reference = newReference();
  const { data: profile } = await svc.from("profiles").select("email").eq("id", sub.sponsor_user_id).maybeSingle();
  const email = profile?.email ?? `sponsor-${sub.sponsor_user_id.slice(0, 8)}@payments.covva.com.gh`;
  const settlement = provider === "simulator" ? "SIMULATED" : insurer.paystack_subaccount_code;
  const { data: payment, error } = await svc
    .from("payments")
    .insert({
      application_id: null,
      request_id: request.id,
      quote_id: quote?.id ?? null,
      policy_id: args.policy.id,
      customer_id: sub.sponsor_user_id,
      payee_org_id: insurer.id,
      amount,
      currency: "GHS",
      provider,
      psp,
      display_currency: sub.display_currency,
      display_amount: fx.displayAmount,
      fx_rate: sub.display_currency === "GHS" ? null : fx.rate,
      fx_source: sub.display_currency === "GHS" ? null : fx.source,
      fx_quoted_at: sub.display_currency === "GHS" ? null : fx.quotedAt,
      provider_reference: reference,
      idempotency_key: idempotencyKey,
      channel: "card",
      status: "pending",
      settlement_subaccount: settlement,
      raw_event: { subscription_id: sub.id, charge_no: args.chargeNo, attempt: args.attempt, initialize: { channel: "card", started_at: new Date().toISOString(), display_currency: sub.display_currency, display_amount: fx.displayAmount, fx_disclosure: fx.disclosure, payment_method_id: args.method?.id ?? null }, split: commercial.summary } as unknown as Json,
    })
    .select("*")
    .single();
  if (error || !payment) throw new BusinessRuleError(ruleMessage(error, "We couldn't start the collection."));
  await persistPaymentSplits(svc, payment.id, commercial, settlement);
  await svc.from("subscription_charges").update({ payment_id: payment.id }).eq("subscription_id", sub.id).is("payment_id", null).eq("attempt", args.attempt).eq("status", "pending");

  if (provider === "simulator") {
    const r = await applyPaymentResult(reference, { status: "succeeded", amountMinor: Math.round(amount * 100), currency: "GHS", paidAt: new Date().toISOString(), channel: "card", event: { simulator: true, subscription: true }, source: "simulator" });
    return { paymentId: payment.id, reference, status: r.status ?? "succeeded" };
  }
  const res = await paystack<{ status?: string; reference?: string; amount?: number; currency?: string; paid_at?: string | null; gateway_response?: string; authorization?: unknown; customer?: unknown }>("/transaction/charge_authorization", {
    method: "POST",
    body: {
      email,
      amount: Math.round(amount * 100), // pesewas — the insurer's GHS amount; foreign cards are converted by the issuer
      currency: "GHS",
      reference,
      authorization_code: args.method!.provider_token_ref,
      ...commercial.paystackSettlement,
      metadata: { payment_id: payment.id, subscription_id: sub.id, policy_id: args.policy.id, request_reference: request.reference, display_currency: sub.display_currency, display_amount: fx.displayAmount, psp },
    },
  });
  const d = res.json.data;
  if (!res.ok || !d) {
    const r = await applyPaymentResult(reference, { status: "failed", failureReason: res.json.message ?? "The card could not be charged", event: { source: "charge_authorization", error: res.json }, source: "verify" });
    return { paymentId: payment.id, reference, status: r.status ?? "failed" };
  }
  if (d.status === "success") {
    const r = await applyPaymentResult(reference, { status: "succeeded", amountMinor: d.amount, currency: d.currency, paidAt: d.paid_at ?? null, channel: "card", event: { source: "charge_authorization", data: d }, source: "verify" });
    return { paymentId: payment.id, reference, status: r.status ?? "succeeded" };
  }
  if (d.status === "failed") {
    const r = await applyPaymentResult(reference, { status: "failed", failureReason: d.gateway_response ?? "Declined", event: { source: "charge_authorization", data: d }, source: "verify" });
    return { paymentId: payment.id, reference, status: r.status ?? "failed" };
  }
  // pending / send_otp / open_url etc.: the webhook (charge.success / charge.failed) completes it.
  await svc.from("payments").update({ status: "processing" }).eq("id", payment.id).eq("status", "pending");
  return { paymentId: payment.id, reference, status: "processing" };
}

// ---------------------------------------------------------------------------
// Bank transfer instructions
// ---------------------------------------------------------------------------
function bankTransferFromDetail(p: Pick<PaymentRow, "channel_detail" | "amount" | "currency" | "provider_reference">): BankTransferInstructions | null {
  const d = asObject(p.channel_detail);
  if (typeof d.accountNumber !== "string" || typeof d.bank !== "string") return null;
  return {
    bank: d.bank,
    accountName: String(d.accountName ?? ""),
    accountNumber: d.accountNumber,
    reference: String(d.reference ?? p.provider_reference ?? ""),
    kind: d.kind === "paystack_dva" ? "paystack_dva" : "insurer_account",
    amount: Number(p.amount),
    currency: p.currency,
    instructions: String(d.instructions ?? ""),
  };
}

interface BankTransferSetting { bank?: string; account_name?: string; account_number?: string; reference_prefix?: string }

/**
 * Where a bank transfer goes. Never a Covva account: either a Paystack **dedicated virtual account**
 * for the customer (`PAYSTACK_DVA_ENABLED=true`; Paystack credits it and `charge.success` confirms
 * the payment automatically, settling to the insurer's subaccount) or the INSURER's own bank account
 * (`organizations.settings.bank_account`), in which case the insurer/admin reconciles the credit by
 * reference. `platform_settings.payments.bank_transfer` only supplies the reference prefix and
 * fallback labels — if its account is not an insurer's, it is not used.
 */
async function bankTransferInstructions(
  svc: Svc,
  args: { insurer: { id: string; name: string; settings: Json | null }; customerId: string; email: string; reference: string; amount: number; currency: string },
): Promise<BankTransferInstructions> {
  const { data: setting } = await svc.from("platform_settings").select("value").eq("key", "payments.bank_transfer").maybeSingle();
  const platform = asObject(setting?.value) as BankTransferSetting;
  const prefix = (platform.reference_prefix ?? "COVVA").replace(/[^A-Z0-9-]/gi, "").toUpperCase().slice(0, 12) || "COVVA";
  const reference = `${prefix}-${args.reference}`;
  const amountText = `${args.currency} ${args.amount.toFixed(2)}`;

  if (process.env.PAYSTACK_DVA_ENABLED === "true" && paystackKey()) {
    const dva = await ensureDedicatedAccount(svc, args.customerId, args.email);
    if (dva) {
      return {
        bank: dva.bank_name ?? "Bank",
        accountName: dva.account_name ?? args.insurer.name,
        accountNumber: dva.account_number,
        reference,
        kind: "paystack_dva",
        amount: args.amount,
        currency: args.currency,
        instructions: `Transfer exactly ${amountText} to ${dva.bank_name ?? "the bank"} account ${dva.account_number} (${dva.account_name ?? "Covva collections"}) and quote reference ${reference}. This account is unique to you; the payment is confirmed automatically, usually within minutes, and settles to ${args.insurer.name}.`,
      };
    }
  }

  const insurerAccount = asObject(asObject(args.insurer.settings).bank_account as Json);
  const bank = typeof insurerAccount.bank === "string" ? insurerAccount.bank : null;
  const accountNumber = typeof insurerAccount.account_number === "string" ? insurerAccount.account_number : null;
  if (!bank || !accountNumber) {
    throw new BusinessRuleError(`${args.insurer.name} hasn't set up bank transfers yet. Please pay by mobile money or card, or ask your broker.`);
  }
  const accountName = typeof insurerAccount.account_name === "string" ? insurerAccount.account_name : args.insurer.name;
  return {
    bank,
    accountName,
    accountNumber,
    reference,
    kind: "insurer_account",
    amount: args.amount,
    currency: args.currency,
    instructions: `Transfer exactly ${amountText} to ${bank} account ${accountNumber} (${accountName}) and quote reference ${reference}. The money goes straight to ${args.insurer.name}. Your payment shows as pending until ${args.insurer.name} confirms the credit — usually within one working day.`,
  };
}

/** Paystack dedicated virtual account for a customer (created once, stored in payment_accounts). */
async function ensureDedicatedAccount(svc: Svc, customerId: string, email: string): Promise<Row<"payment_accounts"> | null> {
  const { data: existing } = await svc.from("payment_accounts").select("*").eq("customer_id", customerId).eq("provider", "paystack").eq("active", true).maybeSingle();
  if (existing) return existing;
  const { data: profile } = await svc.from("profiles").select("full_name, phone").eq("id", customerId).maybeSingle();
  const [firstName, ...rest] = (profile?.full_name ?? "Covva Customer").trim().split(/\s+/);
  const customer = await paystack<{ customer_code: string }>("/customer", { method: "POST", body: { email, first_name: firstName, last_name: rest.join(" ") || firstName, phone: profile?.phone ?? undefined } });
  if (!customer.ok || !customer.json.data?.customer_code) {
    log.warn("paystack.dva_customer_failed", { status: customer.status, message: customer.json.message });
    return null;
  }
  const dva = await paystack<{ account_number: string; account_name: string; bank: { name: string }; currency: string }>("/dedicated_account", {
    method: "POST",
    body: { customer: customer.json.data.customer_code, preferred_bank: process.env.PAYSTACK_DVA_BANK ?? undefined },
  });
  if (!dva.ok || !dva.json.data?.account_number) {
    log.warn("paystack.dva_create_failed", { status: dva.status, message: dva.json.message });
    return null;
  }
  const d = dva.json.data;
  const { data: saved, error } = await svc
    .from("payment_accounts")
    .upsert(
      { customer_id: customerId, provider: "paystack", provider_customer_code: customer.json.data.customer_code, account_number: d.account_number, account_name: d.account_name, bank_name: d.bank?.name ?? null, currency: (d.currency ?? "GHS").slice(0, 3), active: true, raw: d as unknown as Json },
      { onConflict: "customer_id,provider" },
    )
    .select("*")
    .single();
  if (error) log.warn("payment_accounts.save_failed", { err: error });
  return saved ?? null;
}

// ---------------------------------------------------------------------------
// Applying results (shared by webhook, verify and simulator)
// ---------------------------------------------------------------------------
export interface PaymentOutcome {
  status: "succeeded" | "failed" | "abandoned" | "reversed" | "refunded";
  /** Amount in minor units (pesewas) as reported by the provider. */
  amountMinor?: number;
  currency?: string;
  paidAt?: string | null;
  channel?: string | null;
  subaccountCode?: string | null;
  failureReason?: string | null;
  event?: unknown;
  source: "webhook" | "verify" | "simulator" | "admin";
}

async function markFailed(svc: Svc, payment: PaymentRow, reason: string, event: Json, notifyCustomer = true, status: Enum<"payment_status"> = "failed") {
  const { data: updated } = await svc
    .from("payments")
    .update({ status, failure_reason: reason.slice(0, 500), raw_event: { ...asObject(payment.raw_event), last_event: event } as Json })
    .eq("id", payment.id)
    .in("status", ["pending", "processing"])
    .select("id");
  if (!updated?.length) return;
  const { data: req } = await svc
    .from("requests")
    .update({ status: "quotes_ready", next_step: "Your payment was not completed. You can try again from your quotes." })
    .eq("id", payment.request_id)
    .eq("status", "payment_confirmation")
    .select("id, reference")
    .maybeSingle();
  await svc.from("request_events").insert({
    request_id: payment.request_id,
    actor_party: "system",
    event: "payment_failed",
    note: "Payment was not completed.",
    data: { payment_id: payment.id, reason } as Json,
  });
  if (notifyCustomer) {
    await notify({
      userId: payment.customer_id,
      kind: "payment.failed",
      title: `Payment not completed${req?.reference ? ` for ${req.reference}` : ""}`,
      body: "Your payment didn't go through. Your quote is still available until it expires — you can try again.",
      link: `/account/requests/${payment.request_id}`,
      data: { request_id: payment.request_id, payment_id: payment.id },
    });
  }
}

/**
 * Apply a provider result to a payment. Idempotent: a succeeded payment is never
 * re-applied (atomic conditional update), and a pending policy is created at most once.
 * Never activates cover — the policy is created as `pending_issuance`.
 */
export async function applyPaymentResult(reference: string, outcome: PaymentOutcome): Promise<{ status: Enum<"payment_status"> | null; policyId?: string | null }> {
  const svc = createServiceClient();
  const { data: payment } = await svc.from("payments").select("*").eq("provider_reference", reference).maybeSingle();
  if (!payment) {
    log.warn("payment.unknown_reference", { reference, source: outcome.source });
    return { status: null };
  }
  const event = (outcome.event ?? null) as Json;

  // Sponsor subscription collections keep the policy in force; they have no application to move along.
  if (isSubscriptionCharge(payment)) {
    const { applySubscriptionChargeOutcome } = await import("@/server/subscriptions");
    return applySubscriptionChargeOutcome(svc, payment, outcome);
  }

  if (outcome.status !== "succeeded") {
    if (outcome.status === "refunded" && payment.status === "refunded") {
      // Refund requested by us earlier (see refundPayment) and now confirmed by the provider.
      const refund = { ...asObject(asObject(payment.raw_event).refund as Json), status: "processed", processed_at: outcome.paidAt ?? new Date().toISOString(), source: outcome.source };
      await svc.from("payments").update({ raw_event: { ...asObject(payment.raw_event), refund, last_event: event } as Json }).eq("id", payment.id);
      return { status: "refunded" };
    }
    if (payment.status === "succeeded" && (outcome.status === "refunded" || outcome.status === "reversed")) {
      await svc.from("payments").update({ status: outcome.status, raw_event: { ...asObject(payment.raw_event), last_event: event } as Json }).eq("id", payment.id);
      log.warn("payment.reversed_or_refunded", { paymentId: payment.id, status: outcome.status });
      return { status: outcome.status };
    }
    if (payment.status === "pending" || payment.status === "processing") {
      await markFailed(svc, payment, outcome.failureReason ?? "Payment not completed", event, true, outcome.status === "abandoned" ? "abandoned" : "failed");
      return { status: outcome.status === "abandoned" ? "abandoned" : "failed" };
    }
    return { status: payment.status };
  }

  // Success: check amount and currency against what we asked for.
  const expectedMinor = Math.round(Number(payment.amount) * 100);
  if ((outcome.amountMinor !== undefined && outcome.amountMinor < expectedMinor) || (outcome.currency && outcome.currency !== payment.currency)) {
    log.error("payment.amount_mismatch", { paymentId: payment.id, expectedMinor, got: outcome.amountMinor, currency: outcome.currency });
    await markFailed(svc, payment, "Amount or currency did not match the quote — referred to operations", event);
    return { status: "failed" };
  }
  if (outcome.subaccountCode && payment.settlement_subaccount && payment.settlement_subaccount !== "SIMULATED" && outcome.subaccountCode !== payment.settlement_subaccount) {
    log.error("payment.subaccount_mismatch", { paymentId: payment.id, expected: payment.settlement_subaccount, got: outcome.subaccountCode });
  }

  const paidAt = outcome.paidAt ?? new Date().toISOString();
  const { data: claimed } = await svc
    .from("payments")
    .update({
      status: "succeeded",
      paid_at: paidAt,
      channel: toChannel(outcome.channel) ?? payment.channel,
      failure_reason: null,
      raw_event: { ...asObject(payment.raw_event), last_event: event, confirmed_by: outcome.source } as Json,
    })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");
  if (!claimed?.length) return { status: "succeeded", policyId: payment.policy_id };

  // Diaspora: keep the reusable card authorisation (token reference only) when the payer asked for it.
  const savedMethodId = await savePaymentMethodFromOutcome(svc, payment, event);
  const sponsorPlan = sponsorPlanOf(payment);

  const [{ data: quote }, { data: request }] = await Promise.all([
    payment.quote_id ? svc.from("quotes").select("*").eq("id", payment.quote_id).single() : Promise.resolve({ data: null }),
    svc.from("requests").select("id, reference, title, category_id, broker_org_id, customer_id, risk_data, source_broker_org_id").eq("id", payment.request_id).single(),
  ]);
  if (!quote || !request) {
    log.error("payment.missing_quote_or_request", { paymentId: payment.id });
    return { status: "succeeded" };
  }

  await svc.from("quotes").update({ status: "accepted" }).eq("id", quote.id);

  // Pending policy (never active — only the insurer activates cover).
  let policyId: string | null = null;
  const { data: existingPolicy } = await svc.from("policies").select("id").eq("quote_id", quote.id).neq("status", "cancelled").maybeSingle();
  if (existingPolicy) {
    policyId = existingPolicy.id;
  } else {
    let productName: string | null = null;
    if (quote.product_id) {
      const { data: product } = await svc.from("products").select("name").eq("id", quote.product_id).maybeSingle();
      productName = product?.name ?? null;
    }
    const { data: policy, error } = await svc
      .from("policies")
      .insert({
        request_id: request.id,
        quote_id: quote.id,
        customer_id: payment.customer_id,
        insurer_org_id: quote.insurer_org_id,
        broker_org_id: request.broker_org_id ?? quote.broker_org_id,
        category_id: request.category_id,
        product_version_id: quote.product_version_id,
        status: "pending_issuance",
        source: request.source_broker_org_id ? "broker" : "covva",
        summary: productName,
        premium: payment.amount,
        currency: payment.currency,
        billing_period: sponsorPlan?.cadence === "monthly" ? "month" : quote.billing_period,
        sum_insured: quote.sum_insured,
        excess: quote.excess,
        insured_items: { title: request.title, risk: request.risk_data } as Json,
      })
      .select("id, internal_reference")
      .single();
    if (error) log.error("payment.policy_create_failed", { paymentId: payment.id, err: error });
    policyId = policy?.id ?? null;
  }
  if (policyId) await svc.from("payments").update({ policy_id: policyId }).eq("id", payment.id);
  // Ledger: premium to the insurer, commission and platform fee (idempotent; never blocks the flow).
  await recordPaymentLedger(svc, { ...payment, status: "succeeded", paid_at: paidAt, policy_id: policyId });
  // Sponsor plan: the next instalments are collected automatically (server/subscriptions.ts).
  if (sponsorPlan && policyId) {
    try {
      const { createSponsorSubscriptionFromPayment } = await import("@/server/subscriptions");
      await createSponsorSubscriptionFromPayment(svc, { ...payment, status: "succeeded", paid_at: paidAt, policy_id: policyId }, savedMethodId);
    } catch (err) {
      log.error("subscription.create_after_payment_failed", { paymentId: payment.id, err });
    }
  }

  await svc.from("requests").update({ status: "policy_documents", next_step: PAYMENT_DOCS_NEXT_STEP }).eq("id", request.id).in("status", ["quotes_ready", "payment_confirmation"]);
  await svc.from("request_events").insert({
    request_id: request.id,
    actor_party: "system",
    event: "payment_confirmed",
    note: `Payment of ${payment.currency} ${Number(payment.amount).toFixed(2)} confirmed by the payment provider. Awaiting insurer issuance.`,
    data: { payment_id: payment.id, policy_id: policyId, source: outcome.source } as Json,
  });

  await notify({
    userId: payment.customer_id,
    kind: "payment.succeeded",
    title: `Payment received for ${request.reference}`,
    body: PAYMENT_DOCS_NEXT_STEP,
    link: `/account/requests/${request.id}`,
    data: { request_id: request.id, payment_id: payment.id, policy_id: policyId },
  });
  if (request.broker_org_id) {
    await notifyOrg(request.broker_org_id, {
      kind: "payment.succeeded",
      title: `Payment confirmed for ${request.reference}`,
      body: "The insurer now needs to confirm acceptance and issue the policy.",
      link: `/partner/requests/${request.id}`,
      data: { request_id: request.id, payment_id: payment.id, policy_id: policyId },
    });
  }
  await notifyOrg(quote.insurer_org_id, {
    kind: "policy.pending_issuance",
    title: `Policy awaiting issuance for ${request.reference}`,
    body: "Premium payment confirmed. Confirm acceptance and issue the policy and documents.",
    link: policyId ? `/partner/policies/${policyId}` : `/partner/requests/${request.id}`,
    data: { request_id: request.id, payment_id: payment.id, policy_id: policyId },
  });
  const paid = { payment_id: payment.id, request_id: request.id, reference: request.reference, provider_reference: payment.provider_reference, quote_id: quote.id, policy_id: policyId, amount: Number(payment.amount), currency: payment.currency, status: "succeeded" };
  await emitEvent(request.broker_org_id, "payment.succeeded", paid);
  await emitEvent(quote.insurer_org_id, "payment.succeeded", paid);
  await emitRequestStatus(request.broker_org_id, request, "payment_confirmation", "policy_documents");

  // Issuance engine (Addendum 2 A): delegated L2 issues instantly, L1 starts the insurer's SLA
  // timer, L3 queues for the adapter. Lazy import: issuance → policies → payments is a cycle.
  if (policyId) {
    try {
      const { startIssuance } = await import("@/server/issuance");
      await startIssuance(svc, policyId);
    } catch (err) {
      log.error("issuance.start_failed", { policyId, paymentId: payment.id, err });
    }
  }

  return { status: "succeeded", policyId };
}

// ---------------------------------------------------------------------------
// verifyPayment
// ---------------------------------------------------------------------------
/** Verify a payment with the provider and apply the result (idempotent). */
export async function verifyPayment(reference: string): Promise<{ status: Enum<"payment_status"> }> {
  const svc = createServiceClient();
  const { data: payment } = await svc.from("payments").select("id, status, provider, created_at, settlement_subaccount").eq("provider_reference", reference).maybeSingle();
  if (!payment) throw new BusinessRuleError("Payment not found.", "not_found");
  if (!["pending", "processing"].includes(payment.status)) return { status: payment.status };
  if (payment.provider === "hubtel") {
    const h = await hubtelVerify(reference, payment.settlement_subaccount);
    if (!h.ok) return { status: payment.status };
    if (h.status === "succeeded") {
      const r = await applyPaymentResult(reference, { status: "succeeded", amountMinor: h.amount !== undefined ? Math.round(h.amount * 100) : undefined, paidAt: h.paidAt, channel: hubtelChannel(h.paymentMethod), event: { source: "verify", data: h.raw }, source: "verify" });
      return { status: r.status ?? "succeeded" };
    }
    if (h.status === "failed") {
      const r = await applyPaymentResult(reference, { status: "failed", failureReason: "Declined or cancelled at Hubtel", event: { source: "verify", data: h.raw }, source: "verify" });
      return { status: r.status ?? "failed" };
    }
    return { status: payment.status };
  }
  if (payment.provider !== "paystack" || !paystackKey()) return { status: payment.status };

  const res = await paystack<{
    status: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    channel: string | null;
    gateway_response?: string;
    subaccount?: { subaccount_code?: string } | null;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
  if (!res.ok || !res.json.data) {
    log.warn("paystack.verify_failed", { reference, status: res.status, message: res.json.message });
    return { status: payment.status };
  }
  const d = res.json.data;
  if (d.status === "success") {
    const r = await applyPaymentResult(reference, {
      status: "succeeded",
      amountMinor: d.amount,
      currency: d.currency,
      paidAt: d.paid_at,
      channel: d.channel,
      subaccountCode: d.subaccount?.subaccount_code ?? null,
      event: { source: "verify", data: d },
      source: "verify",
    });
    return { status: r.status ?? "succeeded" };
  }
  if (d.status === "failed" || d.status === "reversed") {
    const r = await applyPaymentResult(reference, { status: d.status === "failed" ? "failed" : "reversed", failureReason: d.gateway_response ?? "Declined", event: { source: "verify", data: d }, source: "verify" });
    return { status: r.status ?? "failed" };
  }
  // "abandoned" / "ongoing" / "pending": still waiting for the customer.
  if (d.status === "abandoned" && Date.now() - new Date(payment.created_at).getTime() > 24 * 3_600_000) {
    const r = await applyPaymentResult(reference, { status: "abandoned", failureReason: "Checkout was not completed", event: { source: "verify", data: d }, source: "verify" });
    return { status: r.status ?? "abandoned" };
  }
  return { status: payment.status };
}

/** Hubtel payment methods → our channel enum. */
export function hubtelChannel(method: string | null | undefined): string | null {
  const m = (method ?? "").toLowerCase();
  if (!m) return null;
  if (/momo|mobile|mtn|vodafone|telecel|airtel|tigo/.test(m)) return "mobile_money";
  if (/card|visa|master/.test(m)) return "card";
  if (/bank|transfer|ghqr|gh-qr/.test(m)) return "bank_transfer";
  return null;
}

/**
 * Admin / insurer reconciliation of a bank transfer: the credit was seen on the insurer's statement, so
 * the pending payment is applied as succeeded (same idempotent path as the webhook). Authorisation is
 * the caller's job — this is a system write.
 */
export async function confirmBankTransfer(paymentId: string, args: { actorId?: string | null; note?: string | null; paidAt?: string | null } = {}): Promise<{ status: Enum<"payment_status"> | null; policyId?: string | null }> {
  const svc = createServiceClient();
  const { data: payment } = await svc.from("payments").select("id, status, provider, provider_reference, request_id").eq("id", paymentId).maybeSingle();
  if (!payment || !payment.provider_reference) throw new BusinessRuleError("Payment not found.", "not_found");
  if (payment.provider !== "bank_transfer") throw new BusinessRuleError("Only bank transfers are confirmed by hand; other providers confirm by webhook.");
  if (payment.status !== "pending" && payment.status !== "processing") return { status: payment.status };
  const r = await applyPaymentResult(payment.provider_reference, {
    status: "succeeded",
    paidAt: args.paidAt ?? new Date().toISOString(),
    channel: "bank_transfer",
    event: { source: "admin", actor_id: args.actorId ?? null, note: args.note ?? null },
    source: "admin",
  });
  return r;
}

// ---------------------------------------------------------------------------
// refundPayment
// ---------------------------------------------------------------------------
export interface RefundResult {
  status: Enum<"payment_status">;
  /** `requested` = provider accepted the refund and will confirm by webhook; `processed` = done (simulator). */
  refund: "requested" | "processed";
}

/**
 * Refund a succeeded premium payment (e.g. the insurer declined the risk after payment).
 * Paystack refunds are asynchronous: `POST /refund` queues it and the provider confirms with
 * `refund.processed` (or `refund.failed`). We mark the payment `refunded` as soon as the
 * provider accepts the request and keep the provider's progress in `raw_event.refund`;
 * a `refund.failed` webhook reverts the payment to `succeeded` and alerts operations.
 * (We deliberately don't reuse `processing`: that status means "customer is paying" and
 * `verifyPayment` would re-apply the original success to it.) Simulator payments are
 * refunded immediately. Authorisation is the caller's job — this is a system write.
 */
export async function refundPayment(paymentId: string, reason: string): Promise<RefundResult> {
  const svc = createServiceClient();
  const { data: payment } = await svc.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!payment) throw new BusinessRuleError("Payment not found.", "not_found");
  if (payment.status === "refunded" || payment.status === "reversed") return { status: payment.status, refund: "processed" };
  if (payment.status !== "succeeded") throw new BusinessRuleError(`Only a confirmed payment can be refunded (this one is ${payment.status}).`);

  const note = reason.trim().slice(0, 500);
  let refund: Record<string, unknown>;
  let result: RefundResult["refund"];
  if (payment.provider === "paystack" && paystackKey()) {
    const res = await paystack<{ id?: number; status?: string; amount?: number; transaction?: unknown }>("/refund", {
      method: "POST",
      body: { transaction: payment.provider_reference, currency: payment.currency, merchant_note: note, customer_note: "Your premium is being refunded because the insurer could not accept the application." },
    });
    if (!res.ok) {
      log.error("paystack.refund_failed", { paymentId: payment.id, status: res.status, message: res.json.message });
      throw new BusinessRuleError(res.json.message ? `The payment provider refused the refund: ${res.json.message}` : "The payment provider could not start the refund. Try again or refund from the Paystack dashboard.");
    }
    refund = { status: "requested", provider_refund_id: res.json.data?.id ?? null, provider_status: res.json.data?.status ?? null, requested_at: new Date().toISOString(), reason: note };
    result = "requested";
  } else if (payment.provider === "hubtel" || payment.provider === "bank_transfer") {
    // No refund API we can drive: the insurer (or Hubtel merchant) returns the money and ops records it.
    refund = { status: "requested", manual: true, provider: payment.provider, requested_at: new Date().toISOString(), reason: note };
    result = "requested";
  } else {
    // Simulator / no provider key: nothing was really charged, so the refund is immediate.
    refund = { status: "processed", provider: payment.provider, requested_at: new Date().toISOString(), processed_at: new Date().toISOString(), reason: note };
    result = "processed";
  }
  const { error } = await svc
    .from("payments")
    .update({ status: "refunded", failure_reason: `Refunded: ${note}`.slice(0, 500), raw_event: { ...asObject(payment.raw_event), refund } as Json })
    .eq("id", payment.id)
    .eq("status", "succeeded");
  if (error) throw new BusinessRuleError(ruleMessage(error, "The refund was requested but could not be recorded. Check the payment in the admin portal."));
  // Ledger: reverse the premium, commission and fee entries (idempotent; never blocks the refund).
  await recordRefundLedger(svc, { ...payment, status: "refunded" }, note);
  await svc.from("request_events").insert({
    request_id: payment.request_id,
    actor_party: "system",
    event: "payment_refunded",
    note: result === "processed" ? `Premium of ${payment.currency} ${Number(payment.amount).toFixed(2)} refunded.` : `Refund of ${payment.currency} ${Number(payment.amount).toFixed(2)} requested from the payment provider. It usually reaches the original payment method within 5–10 working days.`,
    data: { payment_id: payment.id, refund } as Json,
  });
  return { status: "refunded", refund: result };
}

/** Paystack `refund.failed`: the provider could not complete a refund we recorded. Revert and alert. */
export async function applyRefundFailed(reference: string, event: unknown): Promise<void> {
  const svc = createServiceClient();
  const { data: payment } = await svc.from("payments").select("*").eq("provider_reference", reference).maybeSingle();
  if (!payment || payment.status !== "refunded") return;
  const refund = { ...asObject(asObject(payment.raw_event).refund as Json), status: "failed", failed_at: new Date().toISOString() };
  await svc.from("payments").update({ status: "succeeded", failure_reason: "Refund failed at the payment provider — refund manually", raw_event: { ...asObject(payment.raw_event), refund, last_event: event as Json } as Json }).eq("id", payment.id);
  log.error("paystack.refund_processing_failed", { paymentId: payment.id, reference });
  const { data: request } = await svc.from("requests").select("id, reference, broker_org_id").eq("id", payment.request_id).maybeSingle();
  if (request?.broker_org_id) {
    await notifyOrg(request.broker_org_id, {
      kind: "payment.refund_failed",
      title: `Refund failed for ${request.reference}`,
      body: "The payment provider could not process the refund. Arrange it with the insurer and record it on the payment.",
      link: `/partner/requests/${request.id}`,
      data: { request_id: request.id, payment_id: payment.id },
      channels: ["in_app", "email"],
    }, ["owner", "admin", "supervisor", "finance"]);
  }
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------
/** Paystack signs the raw body with HMAC-SHA512 using the secret key (hex in x-paystack-signature). */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secret = paystackKey()): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature.trim(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
