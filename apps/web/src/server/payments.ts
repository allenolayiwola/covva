import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { formatDate } from "@im/core";
import type { Enum, Json, Row } from "@im/db";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError } from "@/server/requests";
import { notify, notifyOrg } from "@/server/notify";
import { log } from "@/server/log";
import { paystackKey, simulatorEnabled, simulatorSignature, siteUrl } from "@/server/env";

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
    .select("id, reference, status, customer_id, broker_org_id")
    .eq("id", app.request_id)
    .single();
  if (!request || request.customer_id !== callerId) throw new BusinessRuleError("Request not found.", "not_found");
  if (request.status !== "quotes_ready" && request.status !== "payment_confirmation") {
    throw new BusinessRuleError("This request isn't ready for payment.");
  }

  const { data: insurer } = await svc
    .from("organizations")
    .select("id, name, type, status, paystack_subaccount_code")
    .eq("id", quote.insurer_org_id)
    .single();
  if (!insurer || insurer.type !== "insurer" || insurer.status !== "active") {
    throw new BusinessRuleError("This insurer can't accept payments right now.");
  }

  const idempotencyKey = `app:${app.id}`;
  const { data: existing } = await svc.from("payments").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing?.status === "succeeded") throw new BusinessRuleError("This application has already been paid.", "conflict");

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
  const amount = Math.round((Number(quote.premium) + Number(quote.taxes) + Number(quote.fees) + benefitTotal) * 100) / 100;
  if (!(amount > 0)) throw new BusinessRuleError("The amount due could not be calculated.");

  const key = paystackKey();
  let provider: "paystack" | "simulator";
  if (key) {
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
  const init = { callback_url: callbackUrl, channel: args.channel, momo_provider: args.momo?.provider ?? null, started_at: new Date().toISOString() };

  const base = {
    application_id: app.id,
    request_id: request.id,
    quote_id: quote.id,
    customer_id: callerId,
    payee_org_id: insurer.id, // premiums settle to the insurer (trigger enforces insurer type)
    amount,
    currency: quote.currency,
    provider,
    provider_reference: reference,
    channel: args.channel as Enum<"payment_channel">,
    status: "pending" as const,
    settlement_subaccount: insurer.paystack_subaccount_code ?? (provider === "simulator" ? "SIMULATED" : null),
    authorization_url: null,
    failure_reason: null,
    raw_event: { initialize: init } as Json,
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

  let authorizationUrl: string | null = null;
  let status: Enum<"payment_status"> = "pending";
  let displayText: string | null = null;
  const metadata = { payment_id: payment.id, application_id: app.id, request_id: request.id, quote_id: quote.id, request_reference: request.reference };

  if (provider === "simulator") {
    authorizationUrl = `${siteUrl()}/api/payments/simulate?reference=${encodeURIComponent(reference)}&sig=${simulatorSignature(reference)}`;
  } else if (args.channel === "mobile_money" && args.momo) {
    const res = await paystack<{ status?: string; display_text?: string; reference?: string }>("/charge", {
      method: "POST",
      body: {
        email,
        amount: Math.round(amount * 100), // pesewas
        currency: "GHS",
        reference,
        mobile_money: { phone: args.momo.phone, provider: args.momo.provider },
        subaccount: insurer.paystack_subaccount_code,
        bearer: "subaccount",
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
        channels: [args.channel],
        subaccount: insurer.paystack_subaccount_code, // settle to the insurer
        bearer: "subaccount",
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
    note: `Payment of ${quote.currency} ${amount.toFixed(2)} started (${provider === "simulator" ? "sandbox simulator" : args.channel.replace(/_/g, " ")}).`,
    data: { payment_id: payment.id, reference, provider } as Json,
  });

  if (status === "succeeded") {
    // Direct charge confirmed synchronously — verify with the provider before applying.
    const v = await verifyPayment(reference);
    status = v.status;
  }
  return { paymentId: payment.id, reference, authorizationUrl, status, displayText };
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
  source: "webhook" | "verify" | "simulator";
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

  if (outcome.status !== "succeeded") {
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

  const [{ data: quote }, { data: request }] = await Promise.all([
    payment.quote_id ? svc.from("quotes").select("*").eq("id", payment.quote_id).single() : Promise.resolve({ data: null }),
    svc.from("requests").select("id, reference, title, category_id, broker_org_id, customer_id, risk_data").eq("id", payment.request_id).single(),
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
        summary: productName,
        premium: payment.amount,
        currency: payment.currency,
        billing_period: quote.billing_period,
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

  return { status: "succeeded", policyId };
}

// ---------------------------------------------------------------------------
// verifyPayment
// ---------------------------------------------------------------------------
/** Verify a payment with the provider and apply the result (idempotent). */
export async function verifyPayment(reference: string): Promise<{ status: Enum<"payment_status"> }> {
  const svc = createServiceClient();
  const { data: payment } = await svc.from("payments").select("id, status, provider, created_at").eq("provider_reference", reference).maybeSingle();
  if (!payment) throw new BusinessRuleError("Payment not found.", "not_found");
  if (!["pending", "processing"].includes(payment.status)) return { status: payment.status };
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
