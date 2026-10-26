import "server-only";
import { formatMoney, graceEnd, instalmentAmount, isCadence, nextChargeDate, parseDisplayCurrency, retrySchedule, type SubscriptionCadence } from "@im/core";
import type { Enum, Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError, ruleMessage } from "@/server/requests";
import { notify, notifyOrg } from "@/server/notify";
import { log } from "@/server/log";
import { quoteFx } from "@/server/fx";
import { resolvePaymentMethod } from "@/server/payment-methods";
import { recordPaymentLedger } from "@/server/ledger";
import { chargeStoredMethod, type PaymentOutcome } from "@/server/payments";
import { paystackKey, simulatorEnabled } from "@/server/env";

/**
 * Recurring sponsor payments (roadmap Phase 2 "Diaspora core"): a sponsor abroad keeps a relative's
 * premium paid on a cadence. Every collection is an ordinary premium payment — a `payments` row in
 * GHS with the INSURER as payee, charged with the sponsor's saved card authorisation — so the
 * ledger, splits and "Covva never holds client funds" hold exactly as for a one-off checkout.
 *
 * Scheduling: Covva's cron (`sponsor-collections`, daily 03:00) charges due subscriptions with the
 * stored method and retries 1d / 3d / 7d before marking the subscription past due. When
 * `PAYSTACK_MANAGED_SUBSCRIPTIONS=true` and the sponsor paid through Paystack, a Paystack plan +
 * subscription is created instead and Paystack drives the charges; the webhook events
 * (`subscription.create`, `charge.success`, `invoice.payment_failed`) land in `handlePaystackSubscriptionEvent`.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type SponsorSubscription = Row<"sponsor_subscriptions">;

export const SUBSCRIPTION_PUBLIC = "id, policy_id, request_id, application_id, beneficiary_id, cadence, display_currency, display_amount, ghs_amount, fx_rate, fx_source, payment_method_id, psp, status, next_charge_at, last_charged_at, past_due_since, paused_at, cancelled_at, failures, created_at, updated_at";

const PAYSTACK = "https://api.paystack.co";

function asObject(v: Json | null | undefined | unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** `platform_settings.payments.grace_days` (default 14): how long cover stays in force after a failed collection. */
export async function graceDays(svc: Svc): Promise<number> {
  const { data } = await svc.from("platform_settings").select("value").eq("key", "payments.grace_days").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n >= 0 ? Math.min(90, n) : 14;
}

function sponsorsPolicy(policy: Record<string, unknown>, userId: string): boolean {
  return policy.customer_id === userId || policy.sponsor_user_id === userId;
}

/** GHS per collection from the policy premium (per billing period) and the cadence. */
function chargeAmountFor(policy: { premium: number | string | null; billing_period: string | null }, cadence: SubscriptionCadence): number {
  const premium = Number(policy.premium) || 0;
  if (!(premium > 0)) throw new BusinessRuleError("This policy has no premium to collect.", "business_rule");
  const annual = policy.billing_period === "month" ? premium * 12 : premium;
  if (policy.billing_period === "month" && cadence === "monthly") return Math.round(premium * 100) / 100;
  return instalmentAmount(annual, cadence);
}

async function assertCadenceAllowed(svc: Svc, insurerOrgId: string, billingPeriod: string | null, cadence: SubscriptionCadence) {
  if (cadence === "annual" || billingPeriod === "month") return;
  const { data: insurer } = await svc.from("organizations").select("name, settings").eq("id", insurerOrgId).maybeSingle();
  if (asObject(insurer?.settings).instalments_allowed !== true) {
    throw new BusinessRuleError(`${insurer?.name ?? "The insurer"} prices this cover yearly. Choose yearly collections or ask your broker about instalments.`);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createSponsorSubscription(args: {
  sponsorUserId: string;
  policyId?: string | null;
  applicationId?: string | null;
  cadence: SubscriptionCadence;
  displayCurrency: string;
  paymentMethodId?: string | null;
  beneficiaryId?: string | null;
  firstChargeAt?: string | null;
}): Promise<SponsorSubscription> {
  const svc = createServiceClient();
  if (!isCadence(args.cadence)) throw new BusinessRuleError("Choose monthly, quarterly or yearly collections.", "invalid_input");
  let policyId = args.policyId ?? null;
  if (!policyId && args.applicationId) {
    const { data: app } = await svc.from("applications").select("quote_id, customer_id").eq("id", args.applicationId).maybeSingle();
    if (!app || app.customer_id !== args.sponsorUserId) throw new BusinessRuleError("Application not found.", "not_found");
    const { data: pol } = await svc.from("policies").select("id").eq("quote_id", app.quote_id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!pol) throw new BusinessRuleError("Pay for the application first; the subscription continues from the policy it creates.", "business_rule");
    policyId = pol.id;
  }
  if (!policyId) throw new BusinessRuleError("Give the policy the subscription pays for.", "invalid_input");
  const { data: policy } = await svc.from("policies").select("*").eq("id", policyId).maybeSingle();
  if (!policy || !sponsorsPolicy(policy as unknown as Record<string, unknown>, args.sponsorUserId)) throw new BusinessRuleError("Policy not found.", "not_found");
  if (!["active", "pending_issuance"].includes(policy.status)) throw new BusinessRuleError(`A subscription needs a live policy (this one is ${policy.status.replace(/_/g, " ")}).`);
  if (policy.external_source || !policy.request_id) throw new BusinessRuleError("Policies added from elsewhere can't be collected through Covva.");
  await assertCadenceAllowed(svc, policy.insurer_org_id!, policy.billing_period, args.cadence);

  const { data: existing } = await svc.from("sponsor_subscriptions").select("*").eq("policy_id", policy.id).eq("sponsor_user_id", args.sponsorUserId).in("status", ["active", "past_due", "paused"]).limit(1).maybeSingle();
  if (existing) return existing;

  const ghsAmount = chargeAmountFor(policy, args.cadence);
  const displayCurrency = parseDisplayCurrency(args.displayCurrency) ?? "GHS";
  const method = await resolvePaymentMethod(svc, args.sponsorUserId, args.paymentMethodId);
  const psp = method?.psp ?? (simulatorEnabled() ? "simulator" : null);
  if (!psp) throw new BusinessRuleError("Save a card first: pay once by card and tick “keep my card for future premiums”.", "business_rule");
  const fx = await quoteFx(ghsAmount, displayCurrency);

  const now = new Date();
  let next = args.firstChargeAt ? new Date(args.firstChargeAt) : null;
  if (!next || Number.isNaN(next.getTime()) || next < now) {
    const anchor = policy.cover_start ? new Date(policy.cover_start) : now;
    next = args.cadence === "annual" && policy.cover_end ? new Date(policy.cover_end) : nextChargeDate(args.cadence, anchor);
    while (next < now) next = nextChargeDate(args.cadence, next);
  }

  const { data: sub, error } = await svc
    .from("sponsor_subscriptions")
    .insert({
      sponsor_user_id: args.sponsorUserId,
      policy_id: policy.id,
      request_id: policy.request_id,
      beneficiary_id: args.beneficiaryId ?? null,
      cadence: args.cadence,
      display_currency: displayCurrency,
      display_amount: fx.displayAmount,
      ghs_amount: ghsAmount,
      fx_rate: displayCurrency === "GHS" ? null : fx.rate,
      fx_source: displayCurrency === "GHS" ? null : fx.source,
      payment_method_id: method?.id ?? null,
      psp,
      status: "active",
      next_charge_at: next.toISOString(),
      metadata: { fx_disclosure: fx.disclosure, created_via: "api" } as Json,
    })
    .select("*")
    .single();
  if (error || !sub) throw new BusinessRuleError(ruleMessage(error, "We couldn't set up the subscription."));
  await maybeCreatePaystackManagedSubscription(svc, sub, method);
  await notify({ userId: args.sponsorUserId, kind: "subscription.created", title: "Recurring premium payments set up", body: `${formatMoney(fx.displayAmount, displayCurrency)}${displayCurrency === "GHS" ? "" : ` (≈ ${formatMoney(ghsAmount, "GHS")} to the insurer)`} ${args.cadence}, first collection ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`, link: "/account/payments/subscriptions", data: { subscription_id: sub.id, policy_id: policy.id }, channels: ["in_app", "email"] });
  return sub;
}

/**
 * Called by `applyPaymentResult` after a successful first checkout that asked for a sponsor plan
 * (`raw_event.initialize.sponsor_subscription`). The first instalment was just paid, so the next
 * collection is one period after `paid_at`.
 */
export async function createSponsorSubscriptionFromPayment(svc: Svc, payment: Row<"payments">, methodId: string | null): Promise<SponsorSubscription | null> {
  const plan = asObject(asObject(asObject(payment.raw_event).initialize).sponsor_subscription);
  const cadence = plan.cadence;
  if (!isCadence(cadence) || !payment.policy_id) return null;
  const { data: existing } = await svc.from("sponsor_subscriptions").select("*").eq("policy_id", payment.policy_id).eq("sponsor_user_id", payment.customer_id).in("status", ["active", "past_due", "paused"]).limit(1).maybeSingle();
  if (existing) return existing;
  let method: Row<"payment_methods"> | null = null;
  if (methodId) method = (await svc.from("payment_methods").select("*").eq("id", methodId).maybeSingle()).data;
  if (!method) method = await resolvePaymentMethod(svc, payment.customer_id, null);
  const psp = method?.psp ?? (payment.provider === "simulator" ? "simulator" : null);
  if (!psp) {
    log.warn("subscription.no_method_after_payment", { paymentId: payment.id });
    await notify({ userId: payment.customer_id, kind: "subscription.setup_incomplete", title: "We couldn't keep your card for future premiums", body: "The payment went through, but the card can't be reused. Set up the recurring payment again from Payments → Subscriptions after your next card payment.", link: "/account/payments/subscriptions", data: { payment_id: payment.id } });
    return null;
  }
  const displayCurrency = parseDisplayCurrency(payment.display_currency) ?? "GHS";
  const ghsAmount = Number(payment.amount);
  const next = nextChargeDate(cadence, payment.paid_at ?? new Date());
  const { data: sub, error } = await svc
    .from("sponsor_subscriptions")
    .insert({
      sponsor_user_id: payment.customer_id,
      policy_id: payment.policy_id,
      request_id: payment.request_id,
      application_id: payment.application_id,
      beneficiary_id: typeof plan.beneficiary_id === "string" ? plan.beneficiary_id : null,
      cadence,
      display_currency: displayCurrency,
      display_amount: Number(payment.display_amount ?? ghsAmount),
      ghs_amount: ghsAmount,
      fx_rate: payment.fx_rate,
      fx_source: payment.fx_source,
      payment_method_id: method?.id ?? null,
      psp,
      status: "active",
      next_charge_at: next.toISOString(),
      metadata: { first_payment_id: payment.id, created_via: "checkout" } as Json,
    })
    .select("*")
    .single();
  if (error || !sub) {
    log.error("subscription.create_from_payment_failed", { paymentId: payment.id, err: error });
    return null;
  }
  await maybeCreatePaystackManagedSubscription(svc, sub, method);
  await notify({ userId: payment.customer_id, kind: "subscription.created", title: "Recurring premium payments set up", body: `Your next premium (${formatMoney(Number(sub.display_amount), displayCurrency)}${displayCurrency === "GHS" ? "" : ` ≈ ${formatMoney(ghsAmount, "GHS")} to the insurer`}) will be collected on ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. You can pause or cancel at any time.`, link: "/account/payments/subscriptions", data: { subscription_id: sub.id, policy_id: payment.policy_id }, channels: ["in_app", "email"] });
  return sub;
}

// ---------------------------------------------------------------------------
// Paystack-managed plans (optional)
// ---------------------------------------------------------------------------
async function paystackPost<T>(path: string, body: unknown): Promise<{ ok: boolean; data?: T; message?: string }> {
  const res = await fetch(`${PAYSTACK}${path}`, { method: "POST", headers: { Authorization: `Bearer ${paystackKey()}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  return { ok: res.ok && json.status !== false, data: json.data, message: json.message };
}

async function maybeCreatePaystackManagedSubscription(svc: Svc, sub: SponsorSubscription, method: Row<"payment_methods"> | null) {
  if (process.env.PAYSTACK_MANAGED_SUBSCRIPTIONS !== "true" || !paystackKey() || !method || !method.psp.startsWith("paystack") || !method.provider_customer_ref) return;
  try {
    const interval = sub.cadence === "monthly" ? "monthly" : sub.cadence === "quarterly" ? "quarterly" : "annually";
    const plan = await paystackPost<{ plan_code: string }>("/plan", { name: `Covva premium ${sub.id.slice(0, 8)}`, interval, amount: Math.round(Number(sub.ghs_amount) * 100), currency: "GHS" });
    if (!plan.ok || !plan.data?.plan_code) throw new Error(plan.message ?? "plan not created");
    const created = await paystackPost<{ subscription_code: string; email_token?: string }>("/subscription", { customer: method.provider_customer_ref, plan: plan.data.plan_code, authorization: method.provider_token_ref, start_date: sub.next_charge_at });
    if (!created.ok || !created.data?.subscription_code) throw new Error(created.message ?? "subscription not created");
    await svc.from("sponsor_subscriptions").update({ psp_subscription_ref: created.data.subscription_code, metadata: { ...asObject(sub.metadata), paystack_plan_code: plan.data.plan_code, managed_by: "paystack" } as Json }).eq("id", sub.id);
  } catch (err) {
    // Fall back to Covva-driven collections (the cron charges the stored authorisation).
    log.warn("subscription.paystack_plan_failed", { subscriptionId: sub.id, err });
  }
}

// ---------------------------------------------------------------------------
// Pause / resume / cancel / retry
// ---------------------------------------------------------------------------
async function ownSubscription(svc: Svc, id: string, userId: string | null): Promise<SponsorSubscription> {
  const { data } = await svc.from("sponsor_subscriptions").select("*").eq("id", id).maybeSingle();
  if (!data || (userId && data.sponsor_user_id !== userId)) throw new BusinessRuleError("Subscription not found.", "not_found");
  return data;
}

export async function pauseSubscription(id: string, userId: string | null): Promise<SponsorSubscription> {
  const svc = createServiceClient();
  const sub = await ownSubscription(svc, id, userId);
  if (sub.status === "cancelled") throw new BusinessRuleError("This subscription was cancelled.");
  if (sub.status === "paused") return sub;
  const { data, error } = await svc.from("sponsor_subscriptions").update({ status: "paused", paused_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't pause the subscription."));
  await notify({ userId: data.sponsor_user_id, kind: "subscription.paused", title: "Recurring payments paused", body: "No premiums will be collected until you resume. Cover may lapse if a premium falls due in the meantime.", link: "/account/payments/subscriptions", data: { subscription_id: id } });
  return data;
}

export async function resumeSubscription(id: string, userId: string | null): Promise<SponsorSubscription> {
  const svc = createServiceClient();
  const sub = await ownSubscription(svc, id, userId);
  if (sub.status === "cancelled") throw new BusinessRuleError("A cancelled subscription can't be resumed — set up a new one.");
  const next = new Date(Math.max(Date.now(), Date.parse(sub.next_charge_at)));
  const { data, error } = await svc.from("sponsor_subscriptions").update({ status: "active", paused_at: null, failures: 0, past_due_since: null, next_charge_at: next.toISOString() }).eq("id", id).select("*").single();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't resume the subscription."));
  return data;
}

export async function cancelSubscription(id: string, userId: string | null, reason?: string | null): Promise<SponsorSubscription> {
  const svc = createServiceClient();
  const sub = await ownSubscription(svc, id, userId);
  if (sub.status === "cancelled") return sub;
  const { data, error } = await svc
    .from("sponsor_subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), metadata: { ...asObject(sub.metadata), cancel_reason: reason?.slice(0, 500) ?? null } as Json })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't cancel the subscription."));
  await notify({ userId: data.sponsor_user_id, kind: "subscription.cancelled", title: "Recurring payments cancelled", body: "No further premiums will be collected. Existing cover runs to its end date; renew by paying again from the policy.", link: "/account/payments/subscriptions", data: { subscription_id: id } });
  return data;
}

/** Admin: clear the failure count and collect at the next cron run. */
export async function retrySubscriptionNow(id: string): Promise<SponsorSubscription> {
  const svc = createServiceClient();
  const sub = await ownSubscription(svc, id, null);
  if (sub.status === "cancelled") throw new BusinessRuleError("This subscription was cancelled.");
  const { data, error } = await svc.from("sponsor_subscriptions").update({ status: "active", failures: 0, next_charge_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't schedule the retry."));
  return data;
}

// ---------------------------------------------------------------------------
// Collections (cron `sponsor-collections`)
// ---------------------------------------------------------------------------
export async function chargeDueSubscriptions(svc: Svc): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const { data: due } = await svc
    .from("sponsor_subscriptions")
    .select("*")
    .in("status", ["active", "past_due"])
    .lte("next_charge_at", now)
    .is("psp_subscription_ref", null)
    .order("next_charge_at")
    .limit(200);
  let charged = 0;
  let failed = 0;
  let skipped = 0;
  for (const sub of due ?? []) {
    if (sub.status === "past_due" && retrySchedule(sub.failures).pastDue) {
      skipped++;
      continue;
    }
    // Claim the row (push next_charge_at out) so an overlapping run never double-charges.
    const { data: claimed } = await svc
      .from("sponsor_subscriptions")
      .update({ next_charge_at: new Date(Date.now() + 86_400_000).toISOString() })
      .eq("id", sub.id)
      .lte("next_charge_at", now)
      .select("*")
      .maybeSingle();
    if (!claimed) {
      skipped++;
      continue;
    }
    const r = await chargeOne(svc, claimed);
    if (r === "succeeded") charged++;
    else if (r === "failed") failed++;
    else skipped++;
  }
  return { due: due?.length ?? 0, charged, failed, pending_or_skipped: skipped };
}

async function chargeOne(svc: Svc, sub: SponsorSubscription): Promise<"succeeded" | "failed" | "pending"> {
  const attempt = sub.failures + 1;
  const { count } = await svc.from("subscription_charges").select("id", { count: "exact", head: true }).eq("subscription_id", sub.id).eq("status", "succeeded");
  const chargeNo = (count ?? 0) + 1;
  const { data: charge } = await svc.from("subscription_charges").insert({ subscription_id: sub.id, attempt, status: "pending" }).select("id").single();
  try {
    if (!sub.policy_id) throw new BusinessRuleError("This subscription has no policy to collect for.");
    const { data: policy } = await svc.from("policies").select("id, request_id, quote_id, customer_id, insurer_org_id, broker_org_id, status, internal_reference").eq("id", sub.policy_id).maybeSingle();
    if (!policy || !policy.insurer_org_id) throw new BusinessRuleError("Policy not found.");
    if (policy.status === "cancelled" || policy.status === "expired") throw new BusinessRuleError(`The policy is ${policy.status}; nothing to collect.`);
    let method: Row<"payment_methods"> | null = null;
    if (sub.payment_method_id) method = (await svc.from("payment_methods").select("*").eq("id", sub.payment_method_id).eq("status", "active").maybeSingle()).data;
    if (!method && sub.psp !== "simulator") throw new BusinessRuleError("No active saved card for this subscription.");
    const r = await chargeStoredMethod({ subscription: sub, method, policy: { ...policy, insurer_org_id: policy.insurer_org_id }, attempt, chargeNo });
    if (charge) await svc.from("subscription_charges").update({ payment_id: r.paymentId }).eq("id", charge.id);
    return r.status === "succeeded" ? "succeeded" : r.status === "failed" || r.status === "abandoned" ? "failed" : "pending";
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Collection failed";
    log.warn("subscription.charge_failed", { subscriptionId: sub.id, attempt, reason });
    await recordChargeFailure(svc, sub, reason, charge?.id ?? null, null);
    return "failed";
  }
}

/** Failure bookkeeping: backoff 1d / 3d / 7d, then past due with notifications and the grace period. */
async function recordChargeFailure(svc: Svc, sub: SponsorSubscription, reason: string, chargeId: string | null, paymentId: string | null) {
  const failures = sub.failures + 1;
  const schedule = retrySchedule(failures);
  const now = new Date();
  if (chargeId) await svc.from("subscription_charges").update({ status: "failed", error: reason.slice(0, 500), payment_id: paymentId ?? undefined }).eq("id", chargeId);
  else if (paymentId) await svc.from("subscription_charges").update({ status: "failed", error: reason.slice(0, 500) }).eq("payment_id", paymentId);
  const patch: Partial<SponsorSubscription> = { failures };
  if (schedule.pastDue) {
    patch.status = "past_due";
    patch.past_due_since = sub.past_due_since ?? now.toISOString();
  } else {
    patch.next_charge_at = new Date(now.getTime() + schedule.retryInDays * 86_400_000).toISOString();
  }
  await svc.from("sponsor_subscriptions").update(patch).eq("id", sub.id);
  const grace = await graceDays(svc);
  const until = graceEnd(patch.past_due_since ?? now, grace);
  await notify({
    userId: sub.sponsor_user_id,
    kind: schedule.pastDue ? "subscription.past_due" : "payment.failed",
    title: schedule.pastDue ? "Premium collection failed — action needed" : "Premium collection failed — we'll retry",
    body: schedule.pastDue
      ? `We couldn't collect the premium after ${failures} attempts (${reason}). Update your card or retry from Payments. The insurer keeps the cover in force until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} (grace period) and may lapse it after that.`
      : `${reason}. We'll try again in ${schedule.retryInDays} day${schedule.retryInDays === 1 ? "" : "s"}. No cover has changed.`,
    link: "/account/payments/subscriptions",
    data: { subscription_id: sub.id, failures, policy_id: sub.policy_id },
    channels: ["in_app", "email", "push", "sms"],
  });
  if (schedule.pastDue && sub.policy_id) {
    const { data: policy } = await svc.from("policies").select("insurer_org_id, broker_org_id, internal_reference").eq("id", sub.policy_id).maybeSingle();
    for (const orgId of [policy?.insurer_org_id, policy?.broker_org_id]) {
      if (!orgId) continue;
      await notifyOrg(orgId, { kind: "subscription.past_due", title: `Sponsor premium past due · ${policy?.internal_reference ?? ""}`.trim(), body: `Collections failed ${failures} times. Grace period ends ${until.toISOString().slice(0, 10)} (${grace} days); the insurer decides whether cover lapses.`, link: `/partner/policies/${sub.policy_id}`, data: { subscription_id: sub.id, policy_id: sub.policy_id }, channels: ["in_app", "email"] });
    }
  }
}

/**
 * Apply a PSP outcome to a subscription collection payment (called by `applyPaymentResult` for
 * payments carrying `raw_event.subscription_id`). Success posts the ledger entries for the GHS amount
 * and schedules the next collection; failure runs the retry schedule. Idempotent.
 */
export async function applySubscriptionChargeOutcome(svc: Svc, payment: Row<"payments">, outcome: PaymentOutcome): Promise<{ status: Enum<"payment_status"> | null; policyId?: string | null }> {
  const subscriptionId = asObject(payment.raw_event).subscription_id;
  const { data: sub } = typeof subscriptionId === "string" ? await svc.from("sponsor_subscriptions").select("*").eq("id", subscriptionId).maybeSingle() : { data: null };
  const event = (outcome.event ?? null) as Json;
  if (!sub) {
    log.error("subscription.payment_orphan", { paymentId: payment.id });
    return { status: payment.status };
  }
  if (outcome.status !== "succeeded") {
    if (payment.status !== "pending" && payment.status !== "processing") return { status: payment.status };
    const status = outcome.status === "abandoned" ? "abandoned" : "failed";
    const reason = outcome.failureReason ?? "Collection not completed";
    const { data: updated } = await svc.from("payments").update({ status, failure_reason: reason.slice(0, 500), raw_event: { ...asObject(payment.raw_event), last_event: event } as Json }).eq("id", payment.id).in("status", ["pending", "processing"]).select("id");
    if (updated?.length) await recordChargeFailure(svc, sub, reason, null, payment.id);
    return { status };
  }
  const expectedMinor = Math.round(Number(payment.amount) * 100);
  if ((outcome.amountMinor !== undefined && outcome.amountMinor < expectedMinor) || (outcome.currency && outcome.currency !== payment.currency)) {
    log.error("subscription.amount_mismatch", { paymentId: payment.id, expectedMinor, got: outcome.amountMinor });
    await svc.from("payments").update({ status: "failed", failure_reason: "Amount or currency did not match — referred to operations", raw_event: { ...asObject(payment.raw_event), last_event: event } as Json }).eq("id", payment.id).in("status", ["pending", "processing"]);
    return { status: "failed" };
  }
  const paidAt = outcome.paidAt ?? new Date().toISOString();
  const { data: claimed } = await svc
    .from("payments")
    .update({ status: "succeeded", paid_at: paidAt, channel: "card", failure_reason: null, raw_event: { ...asObject(payment.raw_event), last_event: event, confirmed_by: outcome.source } as Json })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");
  if (!claimed?.length) return { status: "succeeded", policyId: payment.policy_id };

  await recordPaymentLedger(svc, { ...payment, status: "succeeded", paid_at: paidAt });
  const scheduledFrom = new Date(Math.max(Date.parse(sub.next_charge_at) - 86_400_000, Date.parse(sub.last_charged_at ?? paidAt)));
  const anchor = Number.isNaN(scheduledFrom.getTime()) ? new Date(paidAt) : scheduledFrom;
  let next = nextChargeDate(sub.cadence as SubscriptionCadence, anchor);
  while (next.getTime() <= Date.now()) next = nextChargeDate(sub.cadence as SubscriptionCadence, next);
  await svc.from("sponsor_subscriptions").update({ last_charged_at: paidAt, next_charge_at: next.toISOString(), failures: 0, past_due_since: null, status: sub.status === "paused" || sub.status === "cancelled" ? sub.status : "active" }).eq("id", sub.id);
  await svc.from("subscription_charges").update({ status: "succeeded", error: null }).eq("payment_id", payment.id);
  await svc.from("request_events").insert({ request_id: payment.request_id, actor_party: "system", event: "payment_confirmed", note: `Sponsor premium collection of ${payment.currency} ${Number(payment.amount).toFixed(2)} confirmed${payment.display_currency && payment.display_currency !== "GHS" ? ` (shown as ${payment.display_currency} ${Number(payment.display_amount).toFixed(2)})` : ""}. Next collection ${next.toISOString().slice(0, 10)}.`, data: { payment_id: payment.id, subscription_id: sub.id, source: outcome.source } as Json });
  const users = new Set([sub.sponsor_user_id, payment.customer_id]);
  await notify([...users].map((userId) => ({ userId, kind: "payment.succeeded", title: "Premium collected", body: `${formatMoney(Number(payment.amount), "GHS")} was paid to the insurer${payment.display_currency && payment.display_currency !== "GHS" ? ` (≈ ${formatMoney(Number(payment.display_amount), payment.display_currency)})` : ""}. Next collection ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`, link: userId === sub.sponsor_user_id ? "/account/payments/subscriptions" : `/account/policies/${payment.policy_id}`, data: { payment_id: payment.id, subscription_id: sub.id, policy_id: payment.policy_id } })));
  return { status: "succeeded", policyId: payment.policy_id };
}

// ---------------------------------------------------------------------------
// Paystack webhook events for managed subscriptions
// ---------------------------------------------------------------------------
interface PaystackSubEvent {
  event: string;
  data: {
    reference?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
    status?: string;
    subscription_code?: string;
    plan?: { plan_code?: string } | string | null;
    subscription?: { subscription_code?: string } | null;
    metadata?: { subscription_id?: string } | null;
    description?: string;
    gateway_response?: string;
  };
}

async function findSubscription(svc: Svc, evt: PaystackSubEvent): Promise<SponsorSubscription | null> {
  const d = evt.data ?? {};
  const metaId = d.metadata?.subscription_id;
  if (metaId) {
    const { data } = await svc.from("sponsor_subscriptions").select("*").eq("id", metaId).maybeSingle();
    if (data) return data;
  }
  const code = d.subscription_code ?? d.subscription?.subscription_code;
  if (code) {
    const { data } = await svc.from("sponsor_subscriptions").select("*").eq("psp_subscription_ref", code).maybeSingle();
    if (data) return data;
  }
  const planCode = typeof d.plan === "string" ? d.plan : d.plan?.plan_code;
  if (planCode) {
    const { data } = await svc.from("sponsor_subscriptions").select("*").eq("metadata->>paystack_plan_code", planCode).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Returns true when the event belonged to a sponsor subscription and was handled. */
export async function handlePaystackSubscriptionEvent(evt: PaystackSubEvent): Promise<boolean> {
  const svc = createServiceClient();
  const sub = await findSubscription(svc, evt);
  if (!sub) return false;
  switch (evt.event) {
    case "subscription.create": {
      const code = evt.data.subscription_code ?? sub.psp_subscription_ref;
      await svc.from("sponsor_subscriptions").update({ psp_subscription_ref: code, status: sub.status === "cancelled" ? "cancelled" : "active", metadata: { ...asObject(sub.metadata), managed_by: "paystack" } as Json }).eq("id", sub.id);
      return true;
    }
    case "subscription.disable":
    case "subscription.not_renew": {
      await svc.from("sponsor_subscriptions").update({ status: "cancelled", cancelled_at: new Date().toISOString(), metadata: { ...asObject(sub.metadata), cancel_reason: `Paystack ${evt.event}` } as Json }).eq("id", sub.id).neq("status", "cancelled");
      return true;
    }
    case "invoice.payment_failed": {
      await recordChargeFailure(svc, sub, evt.data.description ?? evt.data.gateway_response ?? "Paystack could not charge the card", null, null);
      return true;
    }
    case "charge.success": {
      const reference = evt.data.reference;
      if (!reference) return true;
      const { data: known } = await svc.from("payments").select("id").eq("provider_reference", reference).maybeSingle();
      if (known) return false; // a payment we initiated: the normal path applies it
      if (!sub.policy_id) return true;
      const { data: policy } = await svc.from("policies").select("request_id, quote_id, customer_id, insurer_org_id").eq("id", sub.policy_id).maybeSingle();
      if (!policy?.request_id || !policy.insurer_org_id) return true;
      const { data: payment, error } = await svc
        .from("payments")
        .insert({
          request_id: policy.request_id,
          quote_id: policy.quote_id,
          policy_id: sub.policy_id,
          customer_id: sub.sponsor_user_id,
          payee_org_id: policy.insurer_org_id,
          amount: Number(sub.ghs_amount),
          currency: "GHS",
          provider: "paystack",
          psp: sub.psp,
          provider_reference: reference,
          idempotency_key: `sub:${sub.id}:ext:${reference}`,
          channel: "card",
          status: "pending",
          display_currency: sub.display_currency,
          display_amount: Number(sub.display_amount),
          fx_rate: sub.fx_rate,
          fx_source: sub.fx_source,
          fx_quoted_at: sub.updated_at,
          raw_event: { subscription_id: sub.id, managed_by: "paystack", initialize: { channel: "card", started_at: new Date().toISOString() } } as unknown as Json,
        })
        .select("*")
        .single();
      if (error || !payment) {
        if (error?.code !== "23505") log.error("subscription.external_charge_insert_failed", { subscriptionId: sub.id, err: error });
        return true;
      }
      await svc.from("subscription_charges").insert({ subscription_id: sub.id, payment_id: payment.id, attempt: 1, status: "pending" });
      await applySubscriptionChargeOutcome(svc, payment, { status: "succeeded", amountMinor: evt.data.amount, currency: evt.data.currency, paidAt: evt.data.paid_at ?? null, channel: "card", event: evt, source: "webhook" });
      return true;
    }
    default:
      return false;
  }
}
