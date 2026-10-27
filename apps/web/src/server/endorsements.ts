import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ENDORSEMENT_KINDS,
  adjustmentLabel,
  beforeValues,
  describeChanges,
  endorsementSchemaFor,
  isEndorsementKind,
  proRataAdjustment,
  riskAfterEndorsement,
  type EndorsementKind,
  type RatingRule,
} from "@im/core";
import type { Database, Enum, Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { evaluateUnderwriting, quoteVersion } from "@/server/catalogue";
import { notifyPolicyParties } from "@/server/diaspora-notify";
import { generatePolicyDocuments } from "@/server/issuance";
import { recordLedgerEntries, recordPaymentLedger } from "@/server/ledger";
import { log } from "@/server/log";
import { notify, notifyOrg } from "@/server/notify";
import { initiatePayment, refundPayment, type InitiatePaymentResult } from "@/server/payments";
import { BusinessRuleError, ruleMessage } from "@/server/requests";
import { routeNewRequest } from "@/server/routing";

/**
 * Endorsements (Roadmap Phase 3): structured mid-term changes to a policy.
 *
 *   customer  startEndorsement   → endorsement `submitted` + a request (type `endorsement`) routed to the
 *                                  broker of record (fixed), else straight to the insurer; underwriting rules
 *                                  and the rating engine are re-run on the changed risk for a proposal.
 *   partner   quoteEndorsement   → broker of record or insurer sets the premium adjustment (`quoted`).
 *   customer  acceptEndorsement  → agrees to the price; additional premium is paid to the INSURER through
 *                                  `initiatePayment`; a refund is handled when the insurer applies the change.
 *   insurer   decideEndorsement  → `accepted` / `rejected` (only the insurer decides cover — DB-enforced).
 *   insurer   applyEndorsement   → updates the policy (insured items, sum insured, premium), regenerates the
 *                                  documents and notifies the customer, sponsor and broker.
 *
 * Writes use the caller's RLS client when one is passed (so `endorsements_guard` sees the real user) and
 * the service client otherwise (API keys, system steps). Callers MUST have authenticated the actor and,
 * for partner actions, verified membership of the organisation they pass in.
 */
type Svc = ReturnType<typeof createServiceClient>;
type Db = SupabaseClient<Database>;
export type Endorsement = Row<"endorsements">;
export type EndorsementParty = "customer" | "broker" | "insurer";

const OPEN = ["draft", "submitted", "quoted", "accepted"];
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const asObj = (v: Json | null | undefined): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const money = (n: number | string | null | undefined, c = "GHS") => `${c} ${Math.abs(Number(n ?? 0)).toFixed(2)}`;

type PolicyForChange = Row<"policies"> & { category: { id: string; slug: string; name: string } | null };

async function loadPolicy(svc: Svc, policyId: string): Promise<PolicyForChange | null> {
  const { data } = await svc.from("policies").select("*, category:product_categories!policies_category_id_fkey(id, slug, name)").eq("id", policyId).maybeSingle();
  return (data as unknown as PolicyForChange | null) ?? null;
}

async function loadEndorsement(svc: Svc, id: string): Promise<Endorsement> {
  const { data } = await svc.from("endorsements").select("*").eq("id", id).maybeSingle();
  if (!data) throw new BusinessRuleError("Change request not found.", "not_found");
  return data;
}

function writeError(err: { code?: string; message?: string } | null, fallback: string): never {
  log.warn("endorsement.write_failed", { err });
  throw new BusinessRuleError(ruleMessage(err, fallback), err?.code === "42501" ? "forbidden" : "business_rule");
}

function annual(policy: Pick<Row<"policies">, "premium" | "billing_period">): number | null {
  if (policy.premium == null) return null;
  const p = Number(policy.premium);
  return policy.billing_period === "month" ? p * 12 : p;
}

async function requestEvent(svc: Svc, requestId: string | null, event: string, note: string, data: Record<string, unknown>, opts: { actorId?: string | null; party?: Enum<"party">; visible?: boolean } = {}) {
  if (!requestId) return;
  await svc.from("request_events").insert({ request_id: requestId, actor_id: opts.actorId ?? null, actor_party: opts.party ?? "system", event, note, visible_to_customer: opts.visible ?? true, data: data as Json });
}

/** Where the change is worked: the broker of record, else the insurer. */
async function notifyHandlers(e: Pick<Endorsement, "id" | "broker_org_id" | "insurer_org_id">, title: string, body: string, opts: { insurerToo?: boolean } = {}) {
  const link = `/partner/endorsements?id=${e.id}`;
  if (e.broker_org_id) await notifyOrg(e.broker_org_id, { kind: "endorsement.update", title, body, link, data: { endorsement_id: e.id } });
  if (!e.broker_org_id || opts.insurerToo) await notifyOrg(e.insurer_org_id, { kind: "endorsement.update", title, body, link, data: { endorsement_id: e.id } }, ["owner", "admin", "underwriter"]);
}

// ---------------------------------------------------------------------------
// Start (customer)
// ---------------------------------------------------------------------------
export interface StartEndorsementResult { endorsement: Endorsement; requestId: string | null; proposal: { amount: number; note: string } | null; underwriting: { outcome: string; reasons: string[] } | null }

/**
 * The policyholder asks for a change. `customerId` must be the verified session user. Creates the
 * endorsement and its request (type `endorsement`, `related_policy_id`), routed to the broker of record
 * (`routeNewRequest` with `fixedBrokerOrgId` → broker_fixed) or, without one, to the insurer.
 */
export async function startEndorsement(customerId: string, policyId: string, kind: string, changes: Record<string, unknown>, effectiveFrom: string, opts: { submit?: boolean; source?: Enum<"request_source"> } = {}): Promise<StartEndorsementResult> {
  const svc = createServiceClient();
  const policy = await loadPolicy(svc, policyId);
  if (!policy || policy.customer_id !== customerId) throw new BusinessRuleError("Policy not found.", "not_found");
  if (policy.external_source) throw new BusinessRuleError("This policy was bought elsewhere — contact that insurer to change it.");
  if (policy.status !== "active") throw new BusinessRuleError("Only an active policy can be changed.");
  if (!isEndorsementKind(kind)) throw new BusinessRuleError("Choose what you want to change.", "invalid_input");
  const slug = policy.category?.slug ?? null;
  const schema = endorsementSchemaFor(slug, kind);
  if (!schema) throw new BusinessRuleError(`“${ENDORSEMENT_KINDS[kind].label}” isn't available for ${policy.category?.name ?? "this cover"}.`, "invalid_input");
  const parsed = schema.safeParse(changes);
  if (!parsed.success) throw new BusinessRuleError(parsed.error.issues.map((i) => `${i.path.join(".") || "changes"}: ${i.message}`).join(" "), "invalid_input");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new BusinessRuleError("Enter the date the change should start.", "invalid_input");
  if (effectiveFrom < today()) throw new BusinessRuleError("A change can't start in the past. Choose today or a later date.", "invalid_input");
  if (policy.cover_end && effectiveFrom > policy.cover_end) throw new BusinessRuleError("The change must start before your cover ends.", "invalid_input");

  const { data: open } = await svc.from("endorsements").select("id, reference").eq("policy_id", policy.id).eq("kind", kind).in("status", OPEN).limit(1).maybeSingle();
  if (open) throw new BusinessRuleError(`You already have an open “${ENDORSEMENT_KINDS[kind].label}” request (${open.reference}).`, "conflict");

  const items = asObj(policy.insured_items);
  let risk = asObj(items.risk as Json);
  if (!Object.keys(risk).length && policy.request_id) {
    const { data: original } = await svc.from("requests").select("risk_data").eq("id", policy.request_id).maybeSingle();
    risk = asObj(original?.risk_data);
  }
  const after = parsed.data as Record<string, unknown>;
  const before = beforeValues(kind, slug, risk, policy);
  const nextRisk = riskAfterEndorsement(slug, kind, risk, after, effectiveFrom);

  // Underwriting rules and the rating engine on the changed risk: a proposal only — the broker / insurer quotes.
  let underwriting: StartEndorsementResult["underwriting"] = null;
  let proposal: StartEndorsementResult["proposal"] = null;
  const oldAnnual = annual(policy);
  try {
    if (policy.product_version_id && kind !== "cancel_policy") {
      const uw = await evaluateUnderwriting(svc, policy.product_version_id, nextRisk);
      if (uw.rules > 0) underwriting = { outcome: uw.outcome, reasons: uw.reasons };
      const { data: version } = await svc.from("product_versions").select("rating").eq("id", policy.product_version_id).maybeSingle();
      const rating = version?.rating as unknown as RatingRule | null;
      if (rating?.model && policy.cover_end && oldAnnual != null) {
        const [was, now] = await Promise.all([quoteVersion(svc, rating, risk), quoteVersion(svc, rating, nextRisk)]);
        if (was.ok && now.ok) {
          // Scale the engine's change onto the premium actually charged (insurer loadings, discounts).
          const ratio = was.premium > 0 ? now.premium / was.premium : 1;
          const pr = proRataAdjustment(oldAnnual, round2(oldAnnual * ratio), effectiveFrom, policy.cover_end, { coverStart: policy.cover_start });
          proposal = { amount: pr.amount, note: `Indicative: ${pr.daysRemaining} of ${pr.daysInTerm} days remaining at the rerated premium. Your insurer confirms the final amount.` };
        }
      }
    } else if (kind === "cancel_policy" && policy.cover_end && oldAnnual != null) {
      const pr = proRataAdjustment(oldAnnual, 0, effectiveFrom, policy.cover_end, { coverStart: policy.cover_start });
      proposal = { amount: pr.amount, note: "Indicative pro-rata refund before any short-period charges. The insurer decides the refund under the policy wording." };
    }
  } catch (err) {
    log.warn("endorsement.rating_failed", { policyId, kind, err });
  }

  const submit = opts.submit ?? true;
  const def = ENDORSEMENT_KINDS[kind as EndorsementKind];
  const { data: endorsement, error } = await svc
    .from("endorsements")
    .insert({
      policy_id: policy.id,
      customer_id: policy.customer_id,
      insurer_org_id: policy.insurer_org_id,
      broker_org_id: policy.broker_org_id,
      kind,
      changes: { before, after, lines: describeChanges(before, after), risk_after: nextRisk } as unknown as Json,
      effective_from: effectiveFrom,
      status: "draft",
      proposed_adjustment: proposal?.amount ?? null,
      underwriting: underwriting as unknown as Json,
      created_by: customerId,
    })
    .select("*")
    .single();
  if (error || !endorsement) writeError(error, "We couldn't save your change.");
  if (!submit) return { endorsement, requestId: null, proposal, underwriting };
  const submitted = await submitEndorsement(endorsement.id, { actorId: customerId, source: opts.source, def: def.label, policy });
  return { endorsement: submitted.endorsement, requestId: submitted.requestId, proposal, underwriting };
}

/** Draft → submitted: creates and routes the endorsement request. */
export async function submitEndorsement(endorsementId: string, ctx: { actorId: string; source?: Enum<"request_source">; def?: string; policy?: PolicyForChange }): Promise<{ endorsement: Endorsement; requestId: string }> {
  const svc = createServiceClient();
  const e = await loadEndorsement(svc, endorsementId);
  if (e.customer_id !== ctx.actorId) throw new BusinessRuleError("Change request not found.", "not_found");
  if (e.status !== "draft") throw new BusinessRuleError("This change has already been sent.", "conflict");
  const policy = ctx.policy ?? (await loadPolicy(svc, e.policy_id));
  if (!policy) throw new BusinessRuleError("Policy not found.", "not_found");
  const label = ctx.def ?? ENDORSEMENT_KINDS[e.kind as EndorsementKind]?.label ?? "Policy change";
  const changes = asObj(e.changes);
  const ref = policy.policy_number ?? policy.internal_reference;

  const { data: request, error: reqErr } = await svc
    .from("requests")
    .insert({
      customer_id: e.customer_id,
      category_id: policy.category_id,
      type: "endorsement",
      status: "submitted",
      source: ctx.source ?? "web",
      title: `${label} — policy ${ref}`,
      risk_data: (changes.risk_after ?? {}) as Json,
      related_policy_id: policy.id,
      needs_adviser_review: true,
      next_step: policy.broker_org_id ? "Your broker is reviewing the change with the insurer." : "The insurer is reviewing your change.",
    })
    .select("id, reference, customer_id, category_id, risk_data, title")
    .single();
  if (reqErr || !request) writeError(reqErr, "We couldn't send your change.");

  if (policy.broker_org_id) {
    // Broker of record keeps the policy's servicing (routing engine: fixed broker).
    try {
      await routeNewRequest(svc, request, { fixedBrokerOrgId: policy.broker_org_id });
    } catch (err) {
      log.error("endorsement.route_failed", { requestId: request.id, err });
    }
    await svc.from("requests").update({ status: "adviser_action", broker_org_id: policy.broker_org_id }).eq("id", request.id).is("broker_org_id", null);
    await svc.from("requests").update({ status: "adviser_action" }).eq("id", request.id).eq("status", "submitted");
  } else {
    await svc.from("requests").update({ status: "insurer_response", routing_mode: "insurer_direct" }).eq("id", request.id);
  }

  const { data: updated, error } = await svc.from("endorsements").update({ status: "submitted", request_id: request.id }).eq("id", e.id).eq("status", "draft").select("*").single();
  if (error || !updated) writeError(error, "We couldn't send your change.");
  const lines = (Array.isArray(changes.lines) ? changes.lines : []) as { label: string; before: string; after: string }[];
  await requestEvent(svc, request.id, "endorsement_submitted", `${label} requested from ${e.effective_from}${lines.length ? `: ${lines.map((l) => `${l.label} ${l.before} → ${l.after}`).join("; ")}` : ""}.`, { endorsement_id: e.id, kind: e.kind }, { actorId: ctx.actorId, party: "customer" });
  await notifyHandlers(updated, `Policy change ${updated.reference}: ${label}`, `Policy ${ref} · effective ${e.effective_from}${updated.proposed_adjustment != null ? ` · indicative ${adjustmentLabel(updated.proposed_adjustment)}` : ""}. Review and quote any change in premium.`);
  await notify({ userId: e.customer_id, kind: "endorsement.submitted", title: `We've sent your change ${updated.reference}`, body: "Your insurer will confirm any change in premium before anything changes on your policy.", link: `/account/policies/${policy.id}/changes/${e.id}`, data: { endorsement_id: e.id, policy_id: policy.id } });
  return { endorsement: updated, requestId: request.id };
}

// ---------------------------------------------------------------------------
// Quote (broker of record or insurer)
// ---------------------------------------------------------------------------
export async function quoteEndorsement(args: { orgId: string; actorId: string | null; endorsementId: string; premiumAdjustment: number; note?: string | null; db?: Db }): Promise<Endorsement> {
  const svc = createServiceClient();
  const e = await loadEndorsement(svc, args.endorsementId);
  const party: EndorsementParty | null = args.orgId === e.insurer_org_id ? "insurer" : args.orgId === e.broker_org_id ? "broker" : null;
  if (!party) throw new BusinessRuleError("Change request not found.", "not_found");
  if (!["submitted", "quoted"].includes(e.status)) throw new BusinessRuleError(`A ${e.status} change can't be quoted.`);
  const amount = round2(args.premiumAdjustment);
  const note = args.note?.trim() || null;
  const patch: Partial<Endorsement> = { premium_adjustment: amount, status: "quoted", ...(party === "broker" ? { broker_note: note ?? e.broker_note } : { insurer_note: note ?? e.insurer_note }) };
  const { data, error } = await (args.db ?? svc).from("endorsements").update(patch).eq("id", e.id).select("*").maybeSingle();
  if (error || !data) writeError(error, "We couldn't save the quote.");
  if (e.request_id) await svc.from("requests").update({ next_step: amount === 0 ? "No change in premium. Confirm the change so the insurer can update your policy." : `${adjustmentLabel(amount, e.currency)}. Agree to it so the insurer can update your policy.` }).eq("id", e.request_id);
  await requestEvent(svc, e.request_id, "endorsement_quoted", `${party === "insurer" ? "The insurer" : "Your broker"} confirmed the price of the change: ${adjustmentLabel(amount, e.currency)}.${note ? ` ${note}` : ""}`, { endorsement_id: e.id, premium_adjustment: amount }, { actorId: args.actorId, party });
  await notify({ userId: e.customer_id, kind: "endorsement.quoted", title: `Your change ${e.reference} has been priced`, body: `${adjustmentLabel(amount, e.currency)}. Open it to agree so the insurer can confirm the change.`, link: `/account/policies/${e.policy_id}/changes/${e.id}`, data: { endorsement_id: e.id }, channels: ["in_app", "push", "email", "sms"] });
  return data;
}

// ---------------------------------------------------------------------------
// Accept the price (customer) — pays any additional premium to the insurer
// ---------------------------------------------------------------------------
export interface AcceptEndorsementResult { endorsement: Endorsement; payment: InitiatePaymentResult | null; refundDue: number | null }

/**
 * The customer agrees to the quoted adjustment. Additional premium is collected with `initiatePayment`
 * on a one-off adjustment quote/application on the endorsement request (settles to the insurer's
 * subaccount, split like any premium). The payment is then linked to the endorsed policy and detached
 * from the adjustment quote, so a successful payment never creates a second policy (applyPaymentResult
 * only builds a policy from a payment's quote); `syncEndorsementPayment` posts its ledger entries.
 */
export async function acceptEndorsement(customerId: string, endorsementId: string, opts: { channel?: "mobile_money" | "card" | "bank_transfer"; callbackUrl?: string } = {}): Promise<AcceptEndorsementResult> {
  const svc = createServiceClient();
  const e = await loadEndorsement(svc, endorsementId);
  if (e.customer_id !== customerId) throw new BusinessRuleError("Change request not found.", "not_found");
  const amount = e.premium_adjustment == null ? null : Number(e.premium_adjustment);
  if (amount == null) throw new BusinessRuleError("Your insurer hasn't confirmed the change in premium yet.");

  // Retry of a pending additional-premium payment.
  if (e.customer_accepted_at && e.adjustment_payment_id && amount > 0) {
    const { data: pay } = await svc.from("payments").select("id, status, authorization_url, provider_reference, provider").eq("id", e.adjustment_payment_id).maybeSingle();
    if (pay?.status === "succeeded") throw new BusinessRuleError("The additional premium has already been paid.", "conflict");
    if (pay && (pay.status === "pending" || pay.status === "processing") && pay.authorization_url) {
      return { endorsement: e, payment: { paymentId: pay.id, reference: pay.provider_reference ?? "", authorizationUrl: pay.authorization_url, status: pay.status }, refundDue: null };
    }
  } else if (e.status !== "quoted") {
    throw new BusinessRuleError(e.customer_accepted_at ? "You've already agreed to this change." : `A ${e.status} change can't be accepted.`);
  }

  if (!e.customer_accepted_at) {
    const { data, error } = await svc.from("endorsements").update({ customer_accepted_at: new Date().toISOString() }).eq("id", e.id).eq("status", "quoted").select("*").single();
    if (error || !data) writeError(error, "We couldn't record your answer.");
    Object.assign(e, data);
  }

  let payment: InitiatePaymentResult | null = null;
  if (amount > 0) {
    if (!e.request_id) throw new BusinessRuleError("This change has no request to pay against. Contact your broker.");
    const policy = await loadPolicy(svc, e.policy_id);
    if (!policy) throw new BusinessRuleError("Policy not found.", "not_found");
    const { data: existingApp } = await svc.from("applications").select("id, quote_id").eq("request_id", e.request_id).eq("customer_id", customerId).in("status", ["accepted", "submitted"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    let applicationId = existingApp?.id ?? null;
    if (!applicationId) {
      const { data: quote, error: qErr } = await svc
        .from("quotes")
        .insert({
          request_id: e.request_id,
          insurer_org_id: e.insurer_org_id,
          broker_org_id: e.broker_org_id,
          product_version_id: policy.product_version_id,
          status: "ready_to_accept",
          currency: e.currency,
          premium: amount,
          taxes: 0,
          fees: 0,
          billing_period: "once",
          sum_insured: policy.sum_insured,
          conditions: `Mid-term additional premium for change ${e.reference} to policy ${policy.policy_number ?? policy.internal_reference}, effective ${e.effective_from}.`,
          valid_until: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          assumptions: { endorsement_id: e.id, policy_id: e.policy_id } as Json,
        })
        .select("id")
        .single();
      if (qErr || !quote) writeError(qErr, "We couldn't prepare the payment.");
      // `accepted`: the insurer/broker priced it and the customer agreed — no new application review.
      const { data: app, error: aErr } = await svc
        .from("applications")
        .insert({ request_id: e.request_id, quote_id: quote.id, customer_id: customerId, status: "accepted", terms_accepted_at: new Date().toISOString(), decided_at: new Date().toISOString(), decision_note: `Customer agreed to the adjustment for ${e.reference}.`, declarations: { endorsement_id: e.id } as Json })
        .select("id")
        .single();
      if (aErr || !app) writeError(aErr, "We couldn't prepare the payment.");
      applicationId = app.id;
    }
    await svc.from("requests").update({ status: "quotes_ready", next_step: "Pay the additional premium. The insurer updates your policy once it is paid." }).eq("id", e.request_id).not("status", "in", "(payment_confirmation,completed,cancelled,closed_no_cover)");
    // No direct MoMo prompt: the hosted checkout guarantees the payment is detached below before it can succeed.
    payment = await initiatePayment({ applicationId, channel: opts.channel ?? "mobile_money", userId: customerId, callbackUrl: opts.callbackUrl });
    await svc.from("payments").update({ quote_id: null, policy_id: e.policy_id }).eq("id", payment.paymentId).neq("status", "succeeded");
    const { data } = await svc.from("endorsements").update({ adjustment_payment_id: payment.paymentId }).eq("id", e.id).select("*").single();
    if (data) Object.assign(e, data);
  }

  await requestEvent(svc, e.request_id, "endorsement_customer_accepted", amount > 0 ? `Customer agreed to the additional premium of ${money(amount, e.currency)} and is paying it to the insurer.` : amount < 0 ? `Customer agreed to the change with a refund of ${money(amount, e.currency)}.` : "Customer agreed to the change (no change in premium).", { endorsement_id: e.id }, { actorId: customerId, party: "customer" });
  await notifyHandlers(e, `Customer agreed to change ${e.reference}`, amount > 0 ? `Additional premium ${money(amount, e.currency)} — payment ${payment?.status ?? "started"}. Accept and apply the change once paid.` : "Accept and apply the change to the policy.", { insurerToo: true });
  return { endorsement: e, payment, refundDue: amount < 0 ? Math.abs(amount) : null };
}

/**
 * Posts the ledger for a paid additional premium (premium to insurer, commission, platform fee) against
 * the endorsed policy and tells the insurer. Idempotent; safe to call on every page view.
 */
export async function syncEndorsementPayment(endorsementId: string): Promise<{ status: Enum<"payment_status"> | null }> {
  const svc = createServiceClient();
  const { data: e } = await svc.from("endorsements").select("id, reference, policy_id, request_id, insurer_org_id, broker_org_id, adjustment_payment_id, currency").eq("id", endorsementId).maybeSingle();
  if (!e?.adjustment_payment_id) return { status: null };
  const { data: payment } = await svc.from("payments").select("*").eq("id", e.adjustment_payment_id).maybeSingle();
  if (!payment) return { status: null };
  if (payment.status !== "succeeded") return { status: payment.status };
  const { count } = await svc.from("ledger_entries").select("id", { count: "exact", head: true }).eq("payment_id", payment.id);
  if (!count) {
    if (payment.quote_id) await svc.from("payments").update({ quote_id: null }).eq("id", payment.id); // belt and braces
    await recordPaymentLedger(svc, { ...payment, policy_id: e.policy_id });
    if (e.request_id) await svc.from("requests").update({ status: "payment_confirmation", next_step: "Additional premium paid. The insurer is updating your policy." }).eq("id", e.request_id).in("status", ["quotes_ready", "payment_confirmation"]);
    await requestEvent(svc, e.request_id, "endorsement_paid", `Additional premium of ${money(payment.amount, payment.currency)} confirmed by the payment provider (settled to the insurer).`, { endorsement_id: e.id, payment_id: payment.id });
    await notifyHandlers(e, `Additional premium paid for ${e.reference}`, "Apply the change to the policy to issue the updated documents.", { insurerToo: true });
  }
  return { status: payment.status };
}

// ---------------------------------------------------------------------------
// Decide and apply (insurer only)
// ---------------------------------------------------------------------------
export async function decideEndorsement(args: { insurerOrgId: string; actorId: string | null; endorsementId: string; decision: "accept" | "reject"; note?: string | null; premiumAdjustment?: number; db?: Db }): Promise<Endorsement> {
  const svc = createServiceClient();
  const e = await loadEndorsement(svc, args.endorsementId);
  if (e.insurer_org_id !== args.insurerOrgId) throw new BusinessRuleError("Change request not found.", "not_found");
  if (!["submitted", "quoted"].includes(e.status)) throw new BusinessRuleError(`A ${e.status} change can't be decided.`);
  const note = args.note?.trim() || null;
  if (args.decision === "accept" && args.premiumAdjustment !== undefined && round2(args.premiumAdjustment) !== (e.premium_adjustment == null ? null : Number(e.premium_adjustment))) {
    if (round2(args.premiumAdjustment) !== 0 || e.premium_adjustment != null) throw new BusinessRuleError("Quote the new premium adjustment first — the customer must agree to it before you accept.");
  }
  const { data, error } = await (args.db ?? svc).from("endorsements").update({ status: args.decision === "accept" ? "accepted" : "rejected", insurer_note: note ?? e.insurer_note }).eq("id", e.id).select("*").maybeSingle();
  if (error || !data) writeError(error, "We couldn't record the decision.");

  let refund: string | null = null;
  if (args.decision === "reject" && data.adjustment_payment_id) {
    const { data: pay } = await svc.from("payments").select("id, status").eq("id", data.adjustment_payment_id).maybeSingle();
    if (pay?.status === "succeeded") {
      try {
        refund = (await refundPayment(pay.id, `Insurer did not accept change ${e.reference}`)).refund;
      } catch (err) {
        log.error("endorsement.reject_refund_failed", { endorsementId: e.id, err });
        refund = "failed";
      }
    }
  }
  if (e.request_id) {
    await svc
      .from("requests")
      .update(args.decision === "accept" ? { next_step: "The insurer accepted your change and is updating your policy." } : { status: "closed_no_cover", next_step: "The insurer could not accept this change. Your cover continues unchanged." })
      .eq("id", e.request_id);
  }
  await requestEvent(svc, e.request_id, args.decision === "accept" ? "endorsement_accepted" : "endorsement_rejected", `${args.decision === "accept" ? "The insurer accepted the change" : "The insurer did not accept the change"}${note ? `: ${note}` : "."}${refund ? ` The additional premium is being refunded.` : ""}`, { endorsement_id: e.id, refund }, { actorId: args.actorId, party: "insurer" });
  await notify({
    userId: e.customer_id,
    kind: "endorsement.decided",
    title: args.decision === "accept" ? `Your insurer accepted change ${e.reference}` : `Your insurer couldn't accept change ${e.reference}`,
    body: args.decision === "accept" ? "Your policy documents will be updated shortly." : `${note ?? "Your cover continues unchanged."}${refund ? " Any additional premium you paid is being refunded." : ""}`,
    link: `/account/policies/${e.policy_id}/changes/${e.id}`,
    data: { endorsement_id: e.id },
    channels: ["in_app", "push", "email", "sms"],
  });
  if (e.broker_org_id) await notifyOrg(e.broker_org_id, { kind: "endorsement.update", title: `Insurer ${args.decision === "accept" ? "accepted" : "rejected"} ${e.reference}`, body: note ?? "", link: `/partner/endorsements?id=${e.id}` });
  return data;
}

type Items = { title?: string; risk?: Record<string, unknown>; drivers?: Record<string, unknown>[]; members?: Record<string, unknown>[]; address?: Record<string, unknown>; endorsements?: Record<string, unknown>[] } & Record<string, unknown>;

/** The policy row after a change (pure; exported for tests and previews). */
export function policyPatchFor(policy: Pick<Row<"policies">, "insured_items" | "sum_insured" | "premium" | "status">, e: Pick<Endorsement, "id" | "reference" | "kind" | "effective_from" | "changes" | "premium_adjustment">, categorySlug: string | null, appliedAt: string): Partial<Row<"policies">> {
  const items = { ...(asObj(policy.insured_items) as Items) };
  const changes = asObj(e.changes);
  const after = asObj(changes.after as Json);
  const kind = e.kind as EndorsementKind;
  items.risk = (changes.risk_after as Record<string, unknown> | undefined) ?? riskAfterEndorsement(categorySlug, kind, items.risk ?? {}, after, e.effective_from);
  const nameOf = (r: Record<string, unknown>) => String(r.driver_name ?? r.member_name ?? r.name ?? "").trim().toLowerCase();
  if (kind === "add_driver") items.drivers = [...(items.drivers ?? []), { ...after, added_from: e.effective_from }];
  if (kind === "remove_driver") items.drivers = (items.drivers ?? []).filter((d) => nameOf(d) !== String(after.driver_name ?? "").trim().toLowerCase());
  if (kind === "add_member") items.members = [...(items.members ?? []), { ...after, added_from: e.effective_from }];
  if (kind === "remove_member") items.members = (items.members ?? []).filter((m) => nameOf(m) !== String(after.member_name ?? "").trim().toLowerCase());
  if (kind === "change_address") items.address = after;
  if (kind === "change_vehicle" && typeof after.vehicle_make === "string") items.title = `${after.vehicle_make} ${after.vehicle_model ?? ""} ${after.registration_number ?? ""}`.replace(/\s+/g, " ").trim();
  items.endorsements = [...(items.endorsements ?? []), { id: e.id, reference: e.reference, kind: e.kind, effective_from: e.effective_from, applied_at: appliedAt, lines: changes.lines ?? [], premium_adjustment: e.premium_adjustment }];

  const patch: Partial<Row<"policies">> = { insured_items: items as unknown as Json };
  if (kind === "change_sum_insured" && after.sum_insured != null) patch.sum_insured = Number(after.sum_insured);
  if (kind === "change_vehicle" && categorySlug === "motor" && after.vehicle_value != null) patch.sum_insured = Number(after.vehicle_value);
  const adj = Number(e.premium_adjustment ?? 0);
  if (adj !== 0 && policy.premium != null) patch.premium = Math.max(0, round2(Number(policy.premium) + adj));
  if (kind === "cancel_policy") {
    patch.status = "cancelled";
    patch.cancelled_at = appliedAt;
    patch.cancellation_reason = `Cancelled by the insurer on request (${e.reference}) from ${e.effective_from}${after.reason ? `: ${String(after.reason)}` : ""}`.slice(0, 500);
  }
  return patch;
}

export async function applyEndorsement(args: { insurerOrgId: string; actorId: string | null; endorsementId: string; note?: string | null; db?: Db; insurerName?: string }): Promise<{ endorsement: Endorsement; documents: number; refund: "not_needed" | "manual" | null }> {
  const svc = createServiceClient();
  await syncEndorsementPayment(args.endorsementId);
  const e = await loadEndorsement(svc, args.endorsementId);
  if (e.insurer_org_id !== args.insurerOrgId) throw new BusinessRuleError("Change request not found.", "not_found");
  if (e.status !== "accepted") throw new BusinessRuleError(e.status === "applied" ? "This change has already been applied." : "Accept the change before applying it.", e.status === "applied" ? "conflict" : "business_rule");
  const policy = await loadPolicy(svc, e.policy_id);
  if (!policy || policy.insurer_org_id !== args.insurerOrgId) throw new BusinessRuleError("Policy not found.", "not_found");
  if (policy.status !== "active") throw new BusinessRuleError(`The policy is ${policy.status.replace(/_/g, " ")} — it can't be changed.`);
  const adj = Number(e.premium_adjustment ?? 0);

  // 1. Endorsement → applied first (the guard re-checks the insurer role and that extra premium is paid).
  const note = args.note?.trim() || null;
  const { data: applied, error } = await (args.db ?? svc).from("endorsements").update({ status: "applied", insurer_note: note ?? e.insurer_note }).eq("id", e.id).eq("status", "accepted").select("*").maybeSingle();
  if (error || !applied) writeError(error, "We couldn't apply the change.");

  // 2. Policy (service client — the insurer was verified above; policies_guard trusts the service role).
  const appliedAt = applied.applied_at ?? new Date().toISOString();
  const patch = policyPatchFor(policy, applied, policy.category?.slug ?? null, appliedAt);
  const { error: pErr } = await svc.from("policies").update(patch).eq("id", policy.id);
  if (pErr) {
    log.error("endorsement.policy_update_failed", { endorsementId: e.id, err: pErr });
    throw new BusinessRuleError("The change was recorded but the policy could not be updated. Operations has been alerted.");
  }

  // 3. Refund of a negative adjustment: provider refunds are full-payment only, so record the refund in the
  //    ledger (credited against the insurer) and give the insurer a task to return the money.
  let refund: "not_needed" | "manual" | null = null;
  if (adj < 0) {
    const reference = `${e.reference}:refund`;
    const { count } = await svc.from("ledger_entries").select("id", { count: "exact", head: true }).eq("reference", reference);
    if (!count) await recordLedgerEntries(svc, [{ entry_type: "refund", org_id: e.insurer_org_id, amount: adj, policy_id: policy.id, currency: e.currency, reference, memo: `Mid-term refund for change ${e.reference} (insurer to return to the customer)` }]);
    if (e.request_id) {
      await svc.from("request_tasks").insert({ request_id: e.request_id, kind: "payment", title: `Refund ${money(adj, e.currency)} to the customer for ${e.reference}`, detail: "Return the refund to the customer's original payment method, then mark this task done.", assignee_party: "insurer", due_at: new Date(Date.now() + 10 * 86_400_000).toISOString(), created_by: args.actorId });
    }
    refund = "manual";
  } else {
    refund = "not_needed";
  }
  await svc.from("endorsements").update({ refund_status: refund }).eq("id", e.id);

  // 4. Documents: regenerate the schedule / certificate (and sticker) with the change.
  let documents = 0;
  if (patch.status !== "cancelled" && policy.policy_number) {
    try {
      documents = (await generatePolicyDocuments(svc, policy.id, { replace: true })).length;
    } catch (err) {
      log.error("endorsement.documents_failed", { endorsementId: e.id, err });
    }
  }

  // 5. Request and notifications.
  const label = ENDORSEMENT_KINDS[e.kind as EndorsementKind]?.label ?? "Policy change";
  if (e.request_id) await svc.from("requests").update({ status: "completed", next_step: "Your policy has been updated. New documents are in your wallet." }).eq("id", e.request_id);
  await requestEvent(svc, e.request_id, "endorsement_applied", `${args.insurerName ?? "The insurer"} applied the change (${label}) from ${e.effective_from}.${documents ? ` ${documents} updated documents issued.` : ""}${adj < 0 ? ` A refund of ${money(adj, e.currency)} will be returned to you.` : ""}`, { endorsement_id: e.id, documents }, { actorId: args.actorId, party: "insurer" });
  const title = patch.status === "cancelled" ? `Policy ${policy.policy_number ?? policy.internal_reference} is cancelled` : `Your policy ${policy.policy_number ?? policy.internal_reference} has been updated`;
  const body = `${label} from ${e.effective_from}. ${adj > 0 ? `Additional premium ${money(adj, e.currency)} received.` : adj < 0 ? `A refund of ${money(adj, e.currency)} is on its way.` : "No change in premium."}${documents ? " Your new documents are in your wallet." : ""}`;
  await notify({ userId: e.customer_id, kind: "policy.endorsed", title, body, link: `/account/policies/${policy.id}`, data: { policy_id: policy.id, endorsement_id: e.id }, channels: ["in_app", "push", "email", "sms"] });
  await notifyPolicyParties(policy.id, "policy.endorsed", { title, body, link: `/account/policies/${policy.id}`, data: { policy_id: policy.id, endorsement_id: e.id }, skipUserIds: [e.customer_id] }).catch((err) => log.warn("endorsement.parties_notify_failed", { endorsementId: e.id, err }));
  if (e.broker_org_id) await notifyOrg(e.broker_org_id, { kind: "policy.endorsed", title: `${e.reference} applied to ${policy.policy_number ?? policy.internal_reference}`, body, link: `/partner/endorsements?id=${e.id}` });
  return { endorsement: { ...applied, refund_status: refund }, documents, refund: adj < 0 ? "manual" : "not_needed" };
}

/** Customer, broker or insurer withdraws an open change (before the insurer decides). */
export async function cancelEndorsement(args: { endorsementId: string; actorId: string; reason?: string | null; db: Db }): Promise<Endorsement> {
  const { data, error } = await args.db.from("endorsements").update({ status: "cancelled", cancelled_reason: args.reason?.trim() || null }).eq("id", args.endorsementId).select("*").maybeSingle();
  if (error || !data) writeError(error, "We couldn't withdraw the change.");
  const svc = createServiceClient();
  if (data.request_id) {
    await svc.from("requests").update({ status: "cancelled", cancelled_reason: args.reason?.trim() || "Change withdrawn", next_step: "This change was withdrawn. Your cover continues unchanged." }).eq("id", data.request_id).not("status", "in", "(completed,cancelled,closed_no_cover)");
    await requestEvent(svc, data.request_id, "endorsement_cancelled", `Change withdrawn${args.reason ? `: ${args.reason}` : "."}`, { endorsement_id: data.id }, { actorId: args.actorId });
  }
  return data;
}

/** Party of `userId` on an endorsement row visible to them (for UI choices). */
export function partyOf(e: Pick<Endorsement, "customer_id" | "broker_org_id" | "insurer_org_id">, ctx: { userId?: string | null; orgId?: string | null }): EndorsementParty | null {
  if (ctx.orgId && ctx.orgId === e.insurer_org_id) return "insurer";
  if (ctx.orgId && ctx.orgId === e.broker_org_id) return "broker";
  if (ctx.userId && ctx.userId === e.customer_id) return "customer";
  return null;
}

/** Public shape for the API (no internal ids beyond what the parties already see). */
export function endorsementView(e: Endorsement) {
  const changes = asObj(e.changes);
  return {
    id: e.id,
    reference: e.reference,
    policyId: e.policy_id,
    requestId: e.request_id,
    kind: e.kind,
    kindLabel: ENDORSEMENT_KINDS[e.kind as EndorsementKind]?.label ?? e.kind,
    status: e.status,
    effectiveFrom: e.effective_from,
    changes: { before: changes.before ?? {}, after: changes.after ?? {}, lines: changes.lines ?? [] },
    premiumAdjustment: e.premium_adjustment == null ? null : Number(e.premium_adjustment),
    proposedAdjustment: e.proposed_adjustment == null ? null : Number(e.proposed_adjustment),
    adjustmentLabel: adjustmentLabel(e.premium_adjustment, e.currency),
    currency: e.currency,
    customerAcceptedAt: e.customer_accepted_at,
    insurerNote: e.insurer_note,
    brokerNote: e.broker_note,
    decidedAt: e.decided_at,
    appliedAt: e.applied_at,
    refundStatus: e.refund_status,
    paymentId: e.adjustment_payment_id,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}
