import "server-only";
import {
  buildSchedule,
  formatMoney,
  instalmentRetryAt,
  maskMomoNumber,
  parseInstalmentPlan,
  parseInstalmentPlans,
  reinstatementAllowed,
  scheduleState,
  type InstalmentPlan,
  type InstalmentPlanKey,
  type ScheduleStateResult,
} from "@im/core";
import type { Enum, Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError, ruleMessage } from "@/server/requests";
import { notify, notifyOrg } from "@/server/notify";
import { log } from "@/server/log";
import { recordPaymentLedger } from "@/server/ledger";
import { resolvePaymentMethod } from "@/server/payment-methods";
import { chargeStoredMethod, initiatePayment, initiatePolicyCollection, refundPayment, type InitiatePaymentResult, type PaymentOutcome } from "@/server/payments";
import { simulatorEnabled, siteUrl } from "@/server/env";
import { planDb, type InstalmentRow, type InstalmentScheduleRow, type PlanDb } from "@/server/plan-db";

/**
 * Instalment premiums (roadmap Phase 3). A customer (or a sponsor paying for them) chooses one of the
 * insurer's plans at checkout; the first instalment is paid through the normal checkout
 * (`initiatePayment`), the rest are collected by the `instalment-collections` cron (daily 06:30 and
 * 18:30) — a mobile money prompt the customer approves, the saved card, or a pay link by SMS/WhatsApp.
 *
 * Every instalment is an ordinary premium payment: a `payments` row in GHS with the INSURER as payee,
 * split pro rata (`splitForPayment` with the instalment amount) and posted to the ledger. Covva never
 * holds the money. Retries run on the due date, +2 and +5 days; grace, lapse and reinstatement follow
 * the insurer's plan snapshotted on the schedule (`instalment_schedules.plan`).
 *
 * Exported for other channels (USSD, SME billing): `createScheduleForApplication`, `payInstalment`,
 * `reinstate`, `listSchedulesForUser`, `scheduleForPolicy`, `instalmentPlansForVersion`.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type InstalmentSchedule = InstalmentScheduleRow;
export type Instalment = InstalmentRow;
export interface ScheduleView extends InstalmentScheduleRow {
  instalments: InstalmentRow[];
  state: ScheduleStateResult;
  policy: { id: string; internal_reference: string; policy_number: string | null; status: string; summary: string | null } | null;
}

export type CollectChannel = "mobile_money" | "card" | "link";
export interface CollectArgs {
  channel?: CollectChannel;
  momo?: { phone: string; network: "mtn" | "vod" | "atl" } | null;
  paymentMethodId?: string | null;
  callbackUrl?: string;
}
export interface CollectResult {
  paymentId: string | null;
  reference: string | null;
  status: Enum<"payment_status"> | "link_sent";
  authorizationUrl: string | null;
  displayText: string | null;
  amount: number;
}

const DAY = 86_400_000;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The insurer's plans on a product version (`product_versions.instalment_plans`). */
export async function instalmentPlansForVersion(client: Svc | PlanDb, versionId: string | null | undefined): Promise<InstalmentPlan[]> {
  if (!versionId) return [];
  const { data } = await planDb(client as Svc).from("product_versions").select("instalment_plans").eq("id", versionId).maybeSingle();
  return parseInstalmentPlans(data?.instalment_plans);
}

/** What the customer pays at checkout for an application (premium + taxes + fees + chosen benefits), from the quote. */
async function applicationTotal(svc: Svc, app: { quote_id: string; selected_benefits: Json }): Promise<{ total: number; quote: Row<"quotes"> }> {
  const { data: quote } = await svc.from("quotes").select("*").eq("id", app.quote_id).single();
  if (!quote) throw new BusinessRuleError("Quote not found.", "not_found");
  const selected = new Set(Array.isArray(app.selected_benefits) ? (app.selected_benefits as unknown[]).map(String) : []);
  const benefits = (Array.isArray(quote.optional_benefits) ? quote.optional_benefits : []) as { key?: string; premium?: number }[];
  const benefitTotal = benefits.filter((b) => b.key && selected.has(b.key)).reduce((s, b) => s + (Number(b.premium) || 0), 0);
  return { total: Math.round((Number(quote.premium) + Number(quote.taxes) + Number(quote.fees) + benefitTotal) * 100) / 100, quote };
}

async function loadSchedule(db: PlanDb, id: string): Promise<{ schedule: InstalmentScheduleRow; instalments: InstalmentRow[] } | null> {
  const [{ data: schedule }, { data: rows }] = await Promise.all([
    db.from("instalment_schedules").select("*").eq("id", id).maybeSingle(),
    db.from("instalments").select("*").eq("schedule_id", id).order("seq"),
  ]);
  return schedule ? { schedule, instalments: rows ?? [] } : null;
}

const partiesOf = (s: Pick<InstalmentScheduleRow, "customer_id" | "payer_user_id">) => [...new Set([s.customer_id, s.payer_user_id])];
const canAct = (s: Pick<InstalmentScheduleRow, "customer_id" | "payer_user_id">, userId: string | null) => !userId || s.customer_id === userId || s.payer_user_id === userId;

// ---------------------------------------------------------------------------
// Checkout: create the schedule and pay the first instalment
// ---------------------------------------------------------------------------
export interface CreateScheduleResult {
  schedule: InstalmentScheduleRow;
  instalments: InstalmentRow[];
  payment: InitiatePaymentResult;
}

/**
 * The customer chose an instalment plan at checkout: build the schedule from the insurer's plan and
 * charge the first instalment through the existing checkout (`initiatePayment`, which reads the
 * instalment amount from the DB). Idempotent per application while the first instalment is unpaid.
 */
export async function createScheduleForApplication(args: {
  applicationId: string;
  planKey: InstalmentPlanKey;
  channel: "mobile_money" | "card";
  momo?: { phone: string; provider: "mtn" | "vod" | "atl" };
  /** Verified caller (API v1 / USSD); the cookie session is used when omitted. */
  userId?: string;
  /** A sponsor paying for the customer (defaults to the customer). */
  payerUserId?: string | null;
  callbackUrl?: string;
  saveMethod?: boolean;
}): Promise<CreateScheduleResult> {
  const svc = createServiceClient();
  const db = planDb(svc);
  const { data: app } = await svc.from("applications").select("id, status, quote_id, request_id, customer_id, selected_benefits").eq("id", args.applicationId).maybeSingle();
  if (!app) throw new BusinessRuleError("Application not found.", "not_found");
  if (args.userId && args.userId !== app.customer_id) throw new BusinessRuleError("Application not found.", "not_found");
  if (app.status !== "submitted" && app.status !== "accepted") throw new BusinessRuleError("Submit your application before paying.");
  const { total, quote } = await applicationTotal(svc, app);
  const plans = await instalmentPlansForVersion(svc, quote.product_version_id);
  const plan = plans.find((p) => p.key === args.planKey);
  if (!plan) throw new BusinessRuleError("The insurer doesn't offer that instalment plan for this cover. Choose another plan or pay in full.", "invalid_input");
  if (!quote.insurer_org_id) throw new BusinessRuleError("Quote has no insurer.");

  const { data: existing } = await db.from("instalment_schedules").select("*").eq("application_id", app.id).in("status", ["active"]).is("policy_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let schedule: InstalmentScheduleRow;
  let rows: InstalmentRow[];
  if (existing && existing.plan_key === plan.key) {
    schedule = existing;
    rows = (await db.from("instalments").select("*").eq("schedule_id", existing.id).order("seq")).data ?? [];
    if (rows[0]?.status === "paid") throw new BusinessRuleError("The first instalment is already paid.", "conflict");
  } else {
    if (existing) await db.from("instalment_schedules").update({ status: "cancelled", metadata: { ...asObject(existing.metadata), cancelled_reason: "Customer chose another plan at checkout" } as Json }).eq("id", existing.id);
    const built = buildSchedule(total, plan, new Date());
    const { data: created, error } = await db
      .from("instalment_schedules")
      .insert({
        application_id: app.id,
        customer_id: app.customer_id,
        payer_user_id: args.payerUserId ?? app.customer_id,
        insurer_org_id: quote.insurer_org_id,
        plan_key: plan.key,
        plan: plan as unknown as Json,
        currency: "GHS",
        total_amount: built.total,
        instalment_count: built.count,
        status: "active",
        channel: args.channel,
        momo_network: args.momo?.provider ?? null,
        momo_phone: maskMomoNumber(args.momo?.phone),
        metadata: { premium: built.premium, surcharge: built.surcharge, quote_id: quote.id, created_via: "checkout" } as Json,
      })
      .select("*")
      .single();
    if (error || !created) throw new BusinessRuleError(ruleMessage(error, "We couldn't set up the instalments."));
    const { data: inserted, error: insErr } = await db
      .from("instalments")
      .insert(built.instalments.map((i) => ({ schedule_id: created.id, seq: i.seq, due_at: i.dueAt, amount: i.amount, status: "due", next_attempt_at: i.seq === 1 ? null : i.dueAt })))
      .select("*");
    if (insErr || !inserted) throw new BusinessRuleError(ruleMessage(insErr, "We couldn't set up the instalments."));
    schedule = created;
    rows = inserted.sort((a, b) => a.seq - b.seq);
  }
  const first = rows[0];
  if (!first) throw new BusinessRuleError("The schedule has no instalments.");
  const payment = await initiatePayment({
    applicationId: app.id,
    channel: args.channel,
    momo: args.momo,
    callbackUrl: args.callbackUrl,
    userId: args.userId,
    saveMethod: args.channel === "card" ? args.saveMethod ?? true : false,
    plan: { instalmentId: first.id },
  });
  await db.from("instalments").update({ payment_id: payment.paymentId, attempts: first.attempts + 1, last_attempt_at: new Date().toISOString() }).eq("id", first.id).neq("status", "paid");
  return { schedule, instalments: rows, payment };
}

/** Called by `initiatePayment` for `plan.instalmentId`: the first instalment's amount, checked against the application. */
export async function instalmentChargeForApplication(svc: Svc, args: { instalmentId: string; applicationId: string }): Promise<number> {
  const db = planDb(svc);
  const { data: inst } = await db.from("instalments").select("*").eq("id", args.instalmentId).maybeSingle();
  if (!inst) throw new BusinessRuleError("Instalment not found.", "not_found");
  const { data: schedule } = await db.from("instalment_schedules").select("id, application_id, status").eq("id", inst.schedule_id).maybeSingle();
  if (!schedule || schedule.application_id !== args.applicationId || schedule.status !== "active") throw new BusinessRuleError("Instalment not found.", "not_found");
  if (inst.seq !== 1) throw new BusinessRuleError("Only the first instalment is paid at checkout.");
  if (inst.status === "paid") throw new BusinessRuleError("This instalment has already been paid.", "conflict");
  return Number(inst.amount);
}

/** `applyPaymentResult` hook after the checkout payment of the first instalment created the policy. */
export async function linkFirstInstalment(svc: Svc, payment: Row<"payments">, policyId: string, instalmentId: string): Promise<void> {
  const db = planDb(svc);
  const { data: inst } = await db.from("instalments").select("*").eq("id", instalmentId).maybeSingle();
  if (!inst) return;
  const { data: schedule } = await db.from("instalment_schedules").select("*").eq("id", inst.schedule_id).maybeSingle();
  if (!schedule) return;
  const paidAt = payment.paid_at ?? new Date().toISOString();
  await db.from("instalments").update({ status: "paid", paid_at: paidAt, payment_id: payment.id, next_attempt_at: null }).eq("id", inst.id).neq("status", "paid");
  await db.from("instalment_schedules").update({ policy_id: policyId }).eq("id", schedule.id);
  // The policy records the full (instalment) premium and its schedule; the first payment is only part of it.
  await db.from("policies").update({ premium: Number(schedule.total_amount), instalment_schedule_id: schedule.id }).eq("id", policyId);
  const { data: next } = await db.from("instalments").select("seq, due_at, amount").eq("schedule_id", schedule.id).eq("status", "due").order("seq").limit(1).maybeSingle();
  await notify(partiesOf(schedule).map((userId) => ({
    userId,
    kind: "instalments.created",
    title: "Instalment plan set up",
    body: `First instalment of ${formatMoney(Number(payment.amount), "GHS")} received by the insurer. ${next ? `Next: ${formatMoney(Number(next.amount), "GHS")} on ${fmtDate(next.due_at)}. We'll send a mobile money prompt to approve on the day.` : ""}`.trim(),
    link: "/account/payments/instalments",
    data: { schedule_id: schedule.id, policy_id: policyId },
    channels: ["in_app", "push", "email"],
  })));
}

// ---------------------------------------------------------------------------
// Collecting one instalment (cron, "pay now", reinstatement)
// ---------------------------------------------------------------------------
/** Start a collection for `amount` covering `instalmentIds` of a schedule with a policy. */
async function collect(svc: Svc, schedule: InstalmentScheduleRow, rows: InstalmentRow[], args: CollectArgs & { attempt: number; reinstatement?: boolean; automatic?: boolean }): Promise<CollectResult> {
  if (!schedule.policy_id) throw new BusinessRuleError("This plan's first instalment is paid at checkout.");
  const amount = Math.round(rows.reduce((s, r) => s + Number(r.amount) * 100, 0)) / 100;
  if (!(amount > 0)) throw new BusinessRuleError("Nothing to collect.");
  const ids = rows.map((r) => r.id);
  const tags: Record<string, string | string[] | boolean> = { instalment_id: ids[0]!, instalment_ids: ids, schedule_id: schedule.id, ...(args.reinstatement ? { reinstatement: true } : {}) };
  const key = `inst:${ids.join(",").slice(0, 120)}:${args.reinstatement ? "rein" : "a"}${args.attempt}`;
  const { data: policy } = await svc.from("policies").select("id, request_id, quote_id, customer_id, insurer_org_id, broker_org_id, internal_reference").eq("id", schedule.policy_id).maybeSingle();
  if (!policy?.insurer_org_id) throw new BusinessRuleError("Policy not found.", "not_found");
  const description = `Instalment ${rows.map((r) => r.seq).join(", ")} of ${schedule.instalment_count} · ${policy.internal_reference}`;
  const callbackUrl = args.callbackUrl ?? `${siteUrl()}/account/payments/instalments`;

  // 1. A saved card (sponsor / card plans) — charged without the payer present.
  const wantsCard = args.channel === "card" || (!args.channel && schedule.channel === "card");
  if (wantsCard) {
    const method = await resolvePaymentMethod(svc, schedule.payer_user_id, args.paymentMethodId ?? schedule.payment_method_id);
    if (method || simulatorEnabled()) {
      const r = await chargeStoredMethod({
        subscription: { id: schedule.id, ghs_amount: amount, display_currency: "GHS", sponsor_user_id: schedule.payer_user_id },
        collection: { tags, idempotencyKey: key },
        method,
        policy: { ...policy, insurer_org_id: policy.insurer_org_id },
        attempt: args.attempt,
        chargeNo: rows[0]!.seq,
      }).catch((err: unknown) => {
        if (args.channel === "card") throw err;
        log.warn("instalment.card_unavailable", { scheduleId: schedule.id, err });
        return null;
      });
      if (r) {
        await planDb(svc).from("instalments").update({ payment_id: r.paymentId }).in("id", ids).neq("status", "paid");
        return { paymentId: r.paymentId, reference: r.reference, status: r.status, authorizationUrl: null, displayText: null, amount };
      }
    }
  }

  // 2. Mobile money prompt (the payer approves it on their phone). Automatic runs only prompt the
  //    payer's own profile number when it matches the masked number chosen at checkout.
  let momo = args.momo ? { phone: args.momo.phone, provider: args.momo.network } : null;
  if (!momo && args.automatic && schedule.momo_network && schedule.momo_phone) {
    const { data: profile } = await svc.from("profiles").select("phone").eq("id", schedule.payer_user_id).maybeSingle();
    if (profile?.phone && maskMomoNumber(profile.phone) === schedule.momo_phone) momo = { phone: profile.phone, provider: schedule.momo_network as "mtn" | "vod" | "atl" };
  }
  if (momo || !args.automatic) {
    const r = await initiatePolicyCollection({ policyId: policy.id, payerUserId: schedule.payer_user_id, amount, tags, idempotencyKey: key, channel: momo ? "mobile_money" : args.channel === "card" ? "card" : "link", momo, callbackUrl, description });
    await planDb(svc).from("instalments").update({ payment_id: r.paymentId }).in("id", ids).neq("status", "paid");
    return { ...r, amount };
  }

  // 3. No way to charge without the payer: send a pay link (SMS / WhatsApp / push).
  await notify({
    userId: schedule.payer_user_id,
    kind: "instalment.due",
    title: `Instalment due: ${formatMoney(amount, "GHS")}`,
    body: `Pay instalment ${rows.map((r) => r.seq).join(", ")} of ${schedule.instalment_count} for policy ${policy.internal_reference} by mobile money: ${siteUrl()}/account/payments/instalments?pay=${rows[0]!.id}`,
    link: `/account/payments/instalments?pay=${rows[0]!.id}`,
    data: { schedule_id: schedule.id, instalment_id: rows[0]!.id, policy_id: policy.id },
    channels: ["in_app", "push", "whatsapp", "sms"],
  });
  return { paymentId: null, reference: null, status: "link_sent", authorizationUrl: null, displayText: "We sent a payment link.", amount };
}

/** "Pay now" from the account, the app or USSD: the next unpaid instalment (or a given one). */
export async function payInstalment(instalmentId: string, userId: string | null, args: CollectArgs = {}): Promise<CollectResult> {
  const svc = createServiceClient();
  const db = planDb(svc);
  const { data: inst } = await db.from("instalments").select("*").eq("id", instalmentId).maybeSingle();
  if (!inst) throw new BusinessRuleError("Instalment not found.", "not_found");
  const loaded = await loadSchedule(db, inst.schedule_id);
  if (!loaded || !canAct(loaded.schedule, userId)) throw new BusinessRuleError("Instalment not found.", "not_found");
  const { schedule } = loaded;
  if (inst.status === "paid" || inst.status === "waived") throw new BusinessRuleError("This instalment is already settled.", "conflict");
  if (inst.status === "cancelled" || schedule.status === "cancelled" || schedule.status === "completed") throw new BusinessRuleError("This plan has no payments left to make.");
  if (schedule.status === "lapsed") throw new BusinessRuleError("This cover has lapsed. Reinstate it to pay what is owed.", "business_rule");
  // Earlier unpaid instalments are paid first (oldest debt first).
  const earlier = loaded.instalments.filter((r) => r.seq < inst.seq && (r.status === "due" || r.status === "failed"));
  const rows = [...earlier, inst];
  return collect(svc, schedule, rows, { ...args, attempt: inst.attempts + 1 });
}

// ---------------------------------------------------------------------------
// Outcomes (from applyPaymentResult)
// ---------------------------------------------------------------------------
/** Apply a PSP outcome to an instalment payment (`raw_event.instalment_id`). Idempotent. */
export async function applyInstalmentChargeOutcome(svc: Svc, payment: Row<"payments">, outcome: PaymentOutcome): Promise<{ status: Enum<"payment_status"> | null; policyId?: string | null }> {
  const db = planDb(svc);
  const raw = asObject(payment.raw_event);
  const ids = (Array.isArray(raw.instalment_ids) ? raw.instalment_ids : [raw.instalment_id]).filter((x): x is string => typeof x === "string");
  const event = (outcome.event ?? null) as Json;
  const { data: rows } = ids.length ? await db.from("instalments").select("*").in("id", ids) : { data: [] as InstalmentRow[] };
  const scheduleId = rows?.[0]?.schedule_id;
  const loaded = scheduleId ? await loadSchedule(db, scheduleId) : null;
  if (!loaded) {
    log.error("instalment.payment_orphan", { paymentId: payment.id });
    return { status: payment.status };
  }
  const { schedule } = loaded;
  if (outcome.status !== "succeeded") {
    if (payment.status !== "pending" && payment.status !== "processing") return { status: payment.status };
    const status = outcome.status === "abandoned" ? "abandoned" : "failed";
    const reason = outcome.failureReason ?? "Payment not completed";
    const { data: updated } = await svc.from("payments").update({ status, failure_reason: reason.slice(0, 500), raw_event: { ...raw, last_event: event } as Json }).eq("id", payment.id).in("status", ["pending", "processing"]).select("id");
    if (updated?.length) {
      await db.from("instalments").update({ status: "failed" }).in("id", ids).in("status", ["due", "failed"]);
      const retry = rows?.[0] ? instalmentRetryAt(rows[0].due_at, rows[0].attempts) : null;
      await notify(partiesOf(schedule).map((userId) => ({
        userId,
        kind: "payment.failed",
        title: "Instalment payment not completed",
        body: `${reason}. ${retry && retry.getTime() > Date.now() ? `We'll try again on ${fmtDate(retry.toISOString())}, or pay now from Payments → Instalments.` : "Pay now from Payments → Instalments to keep your cover."}`,
        link: "/account/payments/instalments",
        data: { schedule_id: schedule.id, payment_id: payment.id, policy_id: schedule.policy_id },
      })));
    }
    return { status };
  }
  const expectedMinor = Math.round(Number(payment.amount) * 100);
  if ((outcome.amountMinor !== undefined && outcome.amountMinor < expectedMinor) || (outcome.currency && outcome.currency !== payment.currency)) {
    log.error("instalment.amount_mismatch", { paymentId: payment.id, expectedMinor, got: outcome.amountMinor });
    await svc.from("payments").update({ status: "failed", failure_reason: "Amount or currency did not match — referred to operations", raw_event: { ...raw, last_event: event } as Json }).eq("id", payment.id).in("status", ["pending", "processing"]);
    return { status: "failed" };
  }
  const paidAt = outcome.paidAt ?? new Date().toISOString();
  const { data: claimed } = await svc
    .from("payments")
    .update({ status: "succeeded", paid_at: paidAt, failure_reason: null, raw_event: { ...raw, last_event: event, confirmed_by: outcome.source } as Json })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");
  if (!claimed?.length) return { status: "succeeded", policyId: payment.policy_id };

  // Ledger: each instalment is a premium payment to the insurer (split pro rata at initiation).
  await recordPaymentLedger(svc, { ...payment, status: "succeeded", paid_at: paidAt });
  await db.from("instalments").update({ status: "paid", paid_at: paidAt, payment_id: payment.id, next_attempt_at: null }).in("id", ids).neq("status", "paid");
  if (payment.request_id) {
    await svc.from("request_events").insert({ request_id: payment.request_id, actor_party: "system", event: "payment_confirmed", note: `Instalment ${rows!.map((r) => r.seq).join(", ")} of ${schedule.instalment_count} (${formatMoney(Number(payment.amount), "GHS")}) confirmed and paid to the insurer.`, data: { payment_id: payment.id, schedule_id: schedule.id, source: outcome.source } as Json });
  }

  const fresh = (await loadSchedule(db, schedule.id))!;
  const state = scheduleState(fresh.schedule, fresh.instalments);
  if (raw.reinstatement === true && fresh.schedule.status === "lapsed") {
    await afterReinstatementPaid(svc, fresh.schedule, state);
  } else if (state.state === "completed") {
    await db.from("instalment_schedules").update({ status: "completed", grace_until: null }).eq("id", schedule.id);
  } else if (fresh.schedule.status === "grace" && state.arrears === 0) {
    await db.from("instalment_schedules").update({ status: fresh.schedule.reinstated_at ? "reinstated" : "active", grace_until: null }).eq("id", schedule.id);
  }
  await notify(partiesOf(schedule).map((userId) => ({
    userId,
    kind: "payment.succeeded",
    title: "Instalment paid",
    body: `${formatMoney(Number(payment.amount), "GHS")} was paid to the insurer. ${state.state === "completed" ? "Your premium is fully paid." : state.next ? `Next: ${formatMoney(state.next.amount, "GHS")} on ${fmtDate(state.next.dueAt)}.` : ""}`.trim(),
    link: "/account/payments/instalments",
    data: { schedule_id: schedule.id, payment_id: payment.id, policy_id: schedule.policy_id },
  })));
  return { status: "succeeded", policyId: payment.policy_id };
}

// ---------------------------------------------------------------------------
// Lapse and reinstatement
// ---------------------------------------------------------------------------
/** Insurer's rules: the policy lapses; insurer, broker and customer are told. Issuance hooks are not re-run. */
async function lapseSchedule(svc: Svc, schedule: InstalmentScheduleRow, state: ScheduleStateResult): Promise<void> {
  const db = planDb(svc);
  const now = new Date().toISOString();
  const { data: claimed } = await db.from("instalment_schedules").update({ status: "lapsed", lapsed_at: now }).eq("id", schedule.id).in("status", ["active", "grace", "reinstated"]).select("id");
  if (!claimed?.length || !schedule.policy_id) return;
  const { data: policy } = await svc.from("policies").update({ status: "lapsed" }).eq("id", schedule.policy_id).in("status", ["active", "pending_issuance"]).select("id, internal_reference, policy_number, insurer_org_id, broker_org_id").maybeSingle();
  const ref = policy?.policy_number ?? policy?.internal_reference ?? "your policy";
  const rule = reinstatementAllowed({ ...schedule, status: "lapsed", lapsed_at: now });
  await notify(partiesOf(schedule).map((userId) => ({
    userId,
    kind: "policy.lapsed",
    title: `Cover lapsed: ${ref}`,
    body: `${formatMoney(state.arrears, "GHS")} was not paid by ${state.lapseAt ? fmtDate(state.lapseAt) : "the insurer's deadline"}, so the insurer has lapsed the cover. ${rule.allowed ? `You can reinstate until ${fmtDate(rule.deadline!)} by paying what is owed${rule.requiresReview ? " (the insurer reviews it first)" : ""}.` : rule.reason}`,
    link: "/account/payments/instalments",
    data: { schedule_id: schedule.id, policy_id: schedule.policy_id },
    channels: ["in_app", "push", "email", "sms"],
  })));
  for (const orgId of [policy?.insurer_org_id ?? schedule.insurer_org_id, policy?.broker_org_id]) {
    if (!orgId) continue;
    await notifyOrg(orgId, { kind: "policy.lapsed", title: `Instalments unpaid — policy lapsed · ${ref}`, body: `Arrears ${formatMoney(state.arrears, "GHS")} unpaid ${state.daysOverdue} days after the due date (plan lapse point: ${parseInstalmentPlan(schedule.plan)?.lapse_after_days ?? "?"} days).`, link: `/partner/policies/${schedule.policy_id}`, data: { schedule_id: schedule.id, policy_id: schedule.policy_id }, channels: ["in_app", "email"] });
  }
}

/** Arrears on a lapsed schedule were paid: reinstate now, or ask the insurer to review (insurer task). */
async function afterReinstatementPaid(svc: Svc, schedule: InstalmentScheduleRow, state: ScheduleStateResult): Promise<void> {
  const db = planDb(svc);
  if (state.arrears > 0) return; // part-paid: wait for the rest
  const plan = parseInstalmentPlan(schedule.plan);
  if (plan?.reinstatement.requires_review) {
    await db.from("instalment_schedules").update({ reinstatement_review: "pending" }).eq("id", schedule.id);
    const { data: policy } = schedule.policy_id ? await svc.from("policies").select("id, request_id, internal_reference").eq("id", schedule.policy_id).maybeSingle() : { data: null };
    if (policy?.request_id) {
      await svc.from("request_tasks").insert({ request_id: policy.request_id, kind: "review", assignee_party: "insurer", title: `Review reinstatement of ${policy.internal_reference}`, detail: `Arrears paid on the ${schedule.plan_key} instalment plan. Approve or decline the reinstatement (plan requires insurer review).`, due_at: new Date(Date.now() + 2 * DAY).toISOString() });
    }
    await notifyOrg(schedule.insurer_org_id, { kind: "instalments.reinstatement_review", title: `Reinstatement to review · ${policy?.internal_reference ?? ""}`.trim(), body: "The customer paid the arrears on a lapsed instalment plan. Approve or decline the reinstatement.", link: "/partner/instalments", data: { schedule_id: schedule.id, policy_id: schedule.policy_id }, channels: ["in_app", "email"] }, ["owner", "admin", "underwriter"]);
    await notify(partiesOf(schedule).map((userId) => ({ userId, kind: "instalments.reinstatement_pending", title: "Arrears paid — insurer reviewing", body: "Thank you. The insurer reviews reinstatements under its rules; we'll tell you as soon as cover resumes. If it declines, the arrears are refunded.", link: "/account/payments/instalments", data: { schedule_id: schedule.id } })));
    return;
  }
  await completeReinstatement(svc, schedule, null);
}

async function completeReinstatement(svc: Svc, schedule: InstalmentScheduleRow, actorId: string | null): Promise<void> {
  const db = planDb(svc);
  const now = new Date().toISOString();
  await db.from("instalment_schedules").update({ status: "reinstated", reinstated_at: now, grace_until: null, reinstatement_review: schedule.reinstatement_review ? "approved" : null, metadata: { ...asObject(schedule.metadata), reinstated_by: actorId } as Json }).eq("id", schedule.id);
  if (schedule.policy_id) {
    // Service role: the policy already carries the insurer's number; cover resumes under the insurer's rules.
    const { error } = await svc.from("policies").update({ status: "active" }).eq("id", schedule.policy_id).eq("status", "lapsed");
    if (error) log.error("instalment.reinstate_policy_failed", { scheduleId: schedule.id, err: error });
  }
  await notify(partiesOf(schedule).map((userId) => ({ userId, kind: "instalments.reinstated", title: "Cover reinstated", body: "Your arrears are paid and the insurer has reinstated your cover. The remaining instalments continue as before.", link: "/account/payments/instalments", data: { schedule_id: schedule.id, policy_id: schedule.policy_id }, channels: ["in_app", "push", "email", "sms"] })));
  await notifyOrg(schedule.insurer_org_id, { kind: "instalments.reinstated", title: "Instalment plan reinstated", body: "Arrears paid; the policy is active again.", link: `/partner/policies/${schedule.policy_id}`, data: { schedule_id: schedule.id, policy_id: schedule.policy_id } });
}

/**
 * Reinstate a lapsed schedule: pays every unpaid instalment already due, under the plan's window.
 * When the plan requires insurer review the payment is taken and an insurer task is created.
 */
export async function reinstate(scheduleId: string, userId: string | null, args: CollectArgs = {}): Promise<CollectResult & { requiresReview: boolean }> {
  const svc = createServiceClient();
  const db = planDb(svc);
  const loaded = await loadSchedule(db, scheduleId);
  if (!loaded || !canAct(loaded.schedule, userId)) throw new BusinessRuleError("Instalment plan not found.", "not_found");
  const { schedule, instalments } = loaded;
  const rule = reinstatementAllowed(schedule);
  if (!rule.allowed) throw new BusinessRuleError(rule.reason, "business_rule");
  if (schedule.reinstatement_review === "pending") throw new BusinessRuleError("Your reinstatement is with the insurer for review.", "conflict");
  const now = Date.now();
  const arrears = instalments.filter((r) => (r.status === "due" || r.status === "failed") && Date.parse(r.due_at) <= now);
  if (!arrears.length) {
    await afterReinstatementPaid(svc, schedule, scheduleState(schedule, instalments));
    return { paymentId: null, reference: null, status: "succeeded", authorizationUrl: null, displayText: "Nothing is owed.", amount: 0, requiresReview: rule.requiresReview };
  }
  await db.from("instalment_schedules").update({ reinstatement_requested_at: new Date().toISOString() }).eq("id", schedule.id);
  const r = await collect(svc, schedule, arrears, { ...args, attempt: 1 + Math.max(...arrears.map((a) => a.attempts)), reinstatement: true });
  return { ...r, requiresReview: rule.requiresReview };
}

/** Insurer / staff decision on a reinstatement the plan sent for review. Declined → arrears refunded. */
export async function decideReinstatement(scheduleId: string, args: { approve: boolean; actorId: string | null; note?: string | null; insurerOrgId?: string | null }): Promise<InstalmentScheduleRow> {
  const svc = createServiceClient();
  const db = planDb(svc);
  const loaded = await loadSchedule(db, scheduleId);
  if (!loaded || (args.insurerOrgId && loaded.schedule.insurer_org_id !== args.insurerOrgId)) throw new BusinessRuleError("Instalment plan not found.", "not_found");
  const { schedule } = loaded;
  if (schedule.reinstatement_review !== "pending") throw new BusinessRuleError("There is no reinstatement waiting for review.");
  if (args.approve) {
    await completeReinstatement(svc, schedule, args.actorId);
  } else {
    await db.from("instalment_schedules").update({ reinstatement_review: "declined", metadata: { ...asObject(schedule.metadata), reinstatement_declined: { by: args.actorId, note: args.note?.slice(0, 500) ?? null, at: new Date().toISOString() } } as Json }).eq("id", schedule.id);
    // Refund what was paid for the reinstatement (the insurer keeps nothing it won't cover).
    const { data: payments } = await svc.from("payments").select("id, raw_event, status, paid_at, created_at").eq("policy_id", schedule.policy_id ?? "").eq("status", "succeeded").gte("created_at", schedule.lapsed_at ?? schedule.created_at);
    for (const p of payments ?? []) {
      if (asObject(p.raw_event).reinstatement !== true) continue;
      await refundPayment(p.id, `Reinstatement declined by the insurer${args.note ? `: ${args.note}` : ""}`).catch((err) => log.error("instalment.refund_failed", { paymentId: p.id, err }));
    }
    await notify(partiesOf(schedule).map((userId) => ({ userId, kind: "instalments.reinstatement_declined", title: "Reinstatement declined", body: `The insurer declined to reinstate the cover${args.note ? ` (${args.note})` : ""}. The arrears you paid are being refunded. Ask your broker about new cover.`, link: "/account/payments/instalments", data: { schedule_id: schedule.id } })));
  }
  if (schedule.policy_id) {
    const { data: policy } = await svc.from("policies").select("request_id").eq("id", schedule.policy_id).maybeSingle();
    if (policy?.request_id) await svc.from("request_tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: args.actorId }).eq("request_id", policy.request_id).eq("kind", "review").eq("assignee_party", "insurer").eq("status", "open").like("title", "Review reinstatement%");
  }
  return (await loadSchedule(db, scheduleId))!.schedule;
}

// ---------------------------------------------------------------------------
// Cron `instalment-collections` (daily 06:30 and 18:30)
// ---------------------------------------------------------------------------
export async function collectDueInstalments(svc: Svc): Promise<Record<string, unknown>> {
  const db = planDb(svc);
  const now = new Date();
  const nowIso = now.toISOString();
  let attempted = 0;
  let linkSent = 0;
  let failed = 0;
  let skipped = 0;

  const { data: due } = await db.from("instalments").select("*").in("status", ["due", "failed"]).lte("due_at", nowIso).lte("next_attempt_at", nowIso).order("due_at").limit(200);
  const schedules = new Map<string, InstalmentScheduleRow | null>();
  for (const inst of due ?? []) {
    if (!schedules.has(inst.schedule_id)) schedules.set(inst.schedule_id, (await db.from("instalment_schedules").select("*").eq("id", inst.schedule_id).maybeSingle()).data);
    const schedule = schedules.get(inst.schedule_id);
    if (!schedule || !schedule.policy_id || !["active", "grace", "reinstated"].includes(schedule.status)) {
      skipped++;
      continue;
    }
    // Claim: push the next attempt to the retry schedule (day 0, +2, +5) so overlapping runs never double-charge.
    const attempts = inst.attempts + 1;
    const nextAt = instalmentRetryAt(inst.due_at, attempts);
    const { data: claimed } = await db.from("instalments").update({ attempts, last_attempt_at: nowIso, next_attempt_at: nextAt ? new Date(Math.max(nextAt.getTime(), now.getTime() + 3_600_000)).toISOString() : null }).eq("id", inst.id).eq("attempts", inst.attempts).select("*").maybeSingle();
    if (!claimed) {
      skipped++;
      continue;
    }
    try {
      const r = await collect(svc, schedule, [claimed], { attempt: attempts, automatic: true });
      attempted++;
      if (r.status === "link_sent") linkSent++;
      if (r.status === "failed") failed++;
    } catch (err) {
      failed++;
      log.warn("instalment.collect_failed", { instalmentId: inst.id, err });
    }
  }
  const transitions = await advanceSchedules(svc, now);
  return { due: due?.length ?? 0, attempted, link_sent: linkSent, failed, skipped, ...transitions };
}

/** Grace / lapse / completion per each schedule's plan. */
async function advanceSchedules(svc: Svc, now: Date): Promise<{ entered_grace: number; lapsed: number; completed: number }> {
  const db = planDb(svc);
  const { data: open } = await db.from("instalment_schedules").select("*").in("status", ["active", "grace", "reinstated"]).not("policy_id", "is", null).limit(1000);
  let grace = 0;
  let lapsed = 0;
  let completed = 0;
  for (const s of open ?? []) {
    const { data: rows } = await db.from("instalments").select("*").eq("schedule_id", s.id);
    const state = scheduleState(s, rows ?? [], now);
    if (state.state === "lapsed") {
      await lapseSchedule(svc, s, state);
      lapsed++;
    } else if (state.state === "completed") {
      await db.from("instalment_schedules").update({ status: "completed", grace_until: null }).eq("id", s.id);
      completed++;
    } else if ((state.state === "grace" || state.state === "overdue") && s.status !== "grace") {
      await db.from("instalment_schedules").update({ status: "grace", grace_until: state.graceUntil }).eq("id", s.id);
      grace++;
      await notify(partiesOf(s).map((userId) => ({
        userId,
        kind: "instalments.grace",
        title: "Instalment missed — your cover is still in force",
        body: `${formatMoney(state.arrears, "GHS")} is overdue. Under the insurer's rules your cover stays in force until ${state.graceUntil ? fmtDate(state.graceUntil) : "the end of the grace period"} and lapses on ${state.lapseAt ? fmtDate(state.lapseAt) : "the insurer's deadline"} if unpaid. Pay now from Payments → Instalments.`,
        link: "/account/payments/instalments",
        data: { schedule_id: s.id, policy_id: s.policy_id },
        channels: ["in_app", "push", "email", "sms"],
      })));
    }
  }
  return { entered_grace: grace, lapsed, completed };
}

// ---------------------------------------------------------------------------
// Reads (account, app, admin)
// ---------------------------------------------------------------------------
async function views(svc: Svc, schedules: InstalmentScheduleRow[]): Promise<ScheduleView[]> {
  if (!schedules.length) return [];
  const db = planDb(svc);
  const ids = schedules.map((s) => s.id);
  const policyIds = schedules.map((s) => s.policy_id).filter((x): x is string => !!x);
  const [{ data: rows }, { data: policies }] = await Promise.all([
    db.from("instalments").select("*").in("schedule_id", ids).order("seq"),
    policyIds.length ? svc.from("policies").select("id, internal_reference, policy_number, status, summary").in("id", policyIds) : Promise.resolve({ data: [] as { id: string; internal_reference: string; policy_number: string | null; status: string; summary: string | null }[] }),
  ]);
  const now = new Date();
  return schedules.map((s) => {
    const inst = (rows ?? []).filter((r) => r.schedule_id === s.id);
    return { ...s, instalments: inst, state: scheduleState(s, inst, now), policy: (policies ?? []).find((p) => p.id === s.policy_id) ?? null };
  });
}

/** Schedules the user pays for or is covered by (policy linked). */
export async function listSchedulesForUser(userId: string): Promise<ScheduleView[]> {
  const svc = createServiceClient();
  const { data } = await planDb(svc).from("instalment_schedules").select("*").or(`customer_id.eq.${userId},payer_user_id.eq.${userId}`).not("policy_id", "is", null).order("created_at", { ascending: false }).limit(100);
  return views(svc, data ?? []);
}

/** The live schedule of a policy, if it is paid in instalments (caller checks access to the policy). */
export async function scheduleForPolicy(policyId: string): Promise<ScheduleView | null> {
  const svc = createServiceClient();
  const { data } = await planDb(svc).from("instalment_schedules").select("*").eq("policy_id", policyId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? (await views(svc, [data]))[0] ?? null : null;
}

/** Admin: schedules by status (lapse queue, reviews). */
export async function listSchedulesAdmin(opts: { status?: string | null; review?: boolean; limit?: number } = {}): Promise<ScheduleView[]> {
  const svc = createServiceClient();
  let q = planDb(svc).from("instalment_schedules").select("*").not("policy_id", "is", null).order("updated_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.review) q = q.eq("reinstatement_review", "pending");
  const { data } = await q;
  return views(svc, data ?? []);
}

/** Server-side preview for checkout (no writes). */
export function previewSchedule(total: number, plan: InstalmentPlan, start = new Date()) {
  return buildSchedule(total, plan, start);
}
