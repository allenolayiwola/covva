"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { CLAIM_STATUS, formatGHS, type ClaimStatus } from "@im/core";
import { DECIDABLE, INSURER_STEPS } from "../../_lib/claims";
import { ApiError } from "@/server/api-auth";
import { addClaimMessage, createClaimJob, fulfilInfoRequest, requestClaimInfo, reviewFraudFlag, runFraudChecks, updateClaimJob } from "@/server/claims";
import { notify, notifyOrg } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";
import { ROLES, actionContext, dbMessage, run, type ActionState, type PartnerContext } from "../../_lib/context";

const uuid = z.string().uuid();


async function loadClaim(ctx: PartnerContext, id: string) {
  const { data } = await ctx.supabase.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id, amount_claimed").eq("id", id).maybeSingle();
  return data && data.insurer_org_id === ctx.orgId ? data : null;
}

/** The claim as seen by either partner on it (insurer of record or broker of record). */
async function loadPartnerClaim(ctx: PartnerContext, id: string) {
  const { data } = await ctx.supabase.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id, amount_claimed").eq("id", id).maybeSingle();
  if (!data) return null;
  return (ctx.kind === "insurer" ? data.insurer_org_id : data.broker_org_id) === ctx.orgId ? data : null;
}

/** Partner context for either kind, with the right role gate. */
async function partnerContext() {
  const ctx = await actionContext();
  return actionContext({ kind: ctx.kind, roles: ctx.kind === "insurer" ? ROLES.claims : ROLES.brokerWork });
}

function apiMessage(e: unknown, fallback: string): ActionState {
  if (e instanceof ApiError) return { ok: false, error: e.message };
  console.error("[partner claims action]", e);
  return { ok: false, error: fallback };
}

async function after(ctx: PartnerContext, claim: NonNullable<Awaited<ReturnType<typeof loadClaim>>>, to: ClaimStatus, note?: string) {
  if (note) {
    await ctx.supabase.from("claim_events").insert({ claim_id: claim.id, actor_id: ctx.userId, actor_party: "insurer", note, visible_to_customer: true });
  }
  await notify({
    userId: claim.customer_id,
    kind: "claim.status",
    title: `Claim ${claim.reference}: ${CLAIM_STATUS[to].label}`,
    body: note || CLAIM_STATUS[to].customerHint,
    link: `/account/claims/${claim.id}`,
    data: { claim_id: claim.id, status: to },
    channels: ["in_app", "email", "sms", "push"],
  });
  if (claim.broker_org_id) {
    await notifyOrg(claim.broker_org_id, { kind: "claim.status", title: `${ctx.orgName}: claim ${claim.reference} ${CLAIM_STATUS[to].label.toLowerCase()}`, body: note, link: "/partner/service#claims" });
  }
  const changed = { claim_id: claim.id, reference: claim.reference, from_status: claim.status, status: to };
  await emitEvent(claim.broker_org_id, "claim.status_changed", changed);
  await emitEvent(claim.insurer_org_id, "claim.status_changed", changed);
}

export async function claimStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.claims });
    const input = z
      .object({ claimId: uuid, to: z.enum(["acknowledged", "under_assessment", "info_requested", "closed"]), note: z.string().max(4000).optional(), insurerReference: z.string().max(80).optional() })
      .parse(Object.fromEntries(formData));
    const claim = await loadClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    if (!(INSURER_STEPS[claim.status] ?? []).includes(input.to)) return { ok: false, error: `Can't move from ${CLAIM_STATUS[claim.status].label} to ${CLAIM_STATUS[input.to].label}.` };
    const note = input.note?.trim();
    if (input.to === "info_requested" && !note) return { ok: false, error: "Say what information you need." };
    const { error } = await ctx.supabase
      .from("claims")
      .update({ status: input.to, ...(input.insurerReference?.trim() ? { insurer_reference: input.insurerReference.trim() } : {}) })
      .eq("id", claim.id);
    if (error) return { ok: false, error: dbMessage(error) };
    await after(ctx, claim, input.to, note);
    if (input.to === "info_requested" && note) {
      // The request itself lives in claim_info_requests so the customer can fulfil it from the claim page.
      await requestClaimInfo(ctx.supabase, { claimId: claim.id, userId: ctx.userId, kind: "information", requestedParty: "customer", message: note }).catch(() => {});
    }
    refresh();
    return { ok: true, message: `Claim ${CLAIM_STATUS[input.to].label.toLowerCase()}.` };
  });
}

/** The only place a claim decision is recorded. */
export async function decideClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.claims });
    const input = z
      .object({
        claimId: uuid,
        decision: z.enum(["approved", "partially_approved", "rejected"]),
        amount: z.string().optional(),
        reason: z.string().max(4000).optional(),
      })
      .parse(Object.fromEntries(formData));
    const claim = await loadClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    if (!DECIDABLE.includes(claim.status)) return { ok: false, error: "Acknowledge and assess the claim before recording a decision." };
    const reason = input.reason?.trim();
    const amount = input.amount ? Number(input.amount) : null;
    if (input.decision === "rejected" && (!reason || reason.length < 20)) return { ok: false, error: "A declined claim needs a written reason (at least 20 characters) citing the policy terms." };
    if (input.decision === "partially_approved" && (!amount || amount <= 0)) return { ok: false, error: "Enter the approved amount." };
    if (input.decision === "partially_approved" && !reason) return { ok: false, error: "Explain what is not covered." };
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) return { ok: false, error: "Enter a valid amount." };
    const decisionAmount = input.decision === "rejected" ? null : (amount ?? (claim.amount_claimed != null ? Number(claim.amount_claimed) : null));
    const { error } = await ctx.supabase
      .from("claims")
      .update({ status: input.decision, decision_amount: decisionAmount, decision_note: reason ?? null })
      .eq("id", claim.id);
    if (error) return { ok: false, error: dbMessage(error) };
    const summary =
      input.decision === "rejected"
        ? `Declined: ${reason}`
        : `${CLAIM_STATUS[input.decision].label}${decisionAmount != null ? ` — ${formatGHS(decisionAmount)}` : ""}${reason ? `. ${reason}` : ""}`;
    await after(ctx, claim, input.decision, summary);
    refresh();
    return { ok: true, message: "Decision recorded and shared with the customer and broker." };
  });
}

export async function markClaimPaid(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ["owner", "admin", "claims_officer", "finance"] });
    const input = z.object({ claimId: uuid, reference: z.string().max(120).optional() }).parse(Object.fromEntries(formData));
    const claim = await loadClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    if (!["approved", "partially_approved"].includes(claim.status)) return { ok: false, error: "Only approved claims can be marked paid." };
    const { error } = await ctx.supabase.from("claims").update({ status: "paid" }).eq("id", claim.id);
    if (error) return { ok: false, error: dbMessage(error) };
    await after(ctx, claim, "paid", input.reference?.trim() ? `Settlement reference ${input.reference.trim()}` : undefined);
    refresh();
    return { ok: true, message: "Marked as paid." };
  });
}

// ---------------------------------------------------------------------------
// Thread, information requests, fraud review, partner network (broker or insurer)
// ---------------------------------------------------------------------------
export async function partnerClaimMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await partnerContext();
    const input = z.object({ claimId: uuid, body: z.string().trim().min(1, "Write a message").max(4000), internal: z.enum(["on", "true", "false"]).optional() }).parse(Object.fromEntries(formData));
    const claim = await loadPartnerClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    try {
      await addClaimMessage(ctx.supabase, { claimId: claim.id, userId: ctx.userId, body: input.body, internal: input.internal === "on" || input.internal === "true" });
    } catch (e) {
      return apiMessage(e, "We couldn't send that message.");
    }
    refresh();
    return { ok: true, message: input.internal === "on" || input.internal === "true" ? "Internal note added." : "Message sent to the customer." };
  });
}

export async function partnerRequestInfo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await partnerContext();
    const input = z
      .object({
        claimId: uuid,
        kind: z.enum(["document", "information", "inspection"]).default("document"),
        requestedParty: z.enum(["customer", "broker"]).default("customer"),
        message: z.string().trim().min(3, "Say what you need").max(2000),
        dueAt: z.string().optional(),
        setStatus: z.enum(["on", "true", "false"]).optional(),
      })
      .parse(Object.fromEntries(formData));
    const claim = await loadPartnerClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    const due = input.dueAt?.trim() ? new Date(`${input.dueAt.trim()}T17:00:00Z`) : null;
    try {
      await requestClaimInfo(ctx.supabase, {
        claimId: claim.id,
        userId: ctx.userId,
        kind: input.kind,
        requestedParty: input.requestedParty,
        message: input.message,
        dueAt: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
        setStatus: ctx.kind === "insurer" && (input.setStatus === "on" || input.setStatus === "true"),
      });
    } catch (e) {
      return apiMessage(e, "We couldn't save that request.");
    }
    refresh();
    return { ok: true, message: `Request sent to the ${input.requestedParty}.` };
  });
}

/** Brokers answer an insurer's request on the customer's behalf (document already uploaded, or in writing). */
export async function partnerFulfilInfo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await partnerContext();
    const input = z.object({ claimId: uuid, requestId: uuid, response: z.string().trim().max(2000).optional(), documentId: z.string().optional() }).parse(Object.fromEntries(formData));
    const claim = await loadPartnerClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    const documentId = input.documentId && uuid.safeParse(input.documentId).success ? input.documentId : null;
    try {
      await fulfilInfoRequest(ctx.supabase, { requestId: input.requestId, userId: ctx.userId, documentId, response: input.response || null });
    } catch (e) {
      return apiMessage(e, "We couldn't record that.");
    }
    refresh();
    return { ok: true, message: "Marked as answered." };
  });
}

export async function partnerReviewFraudFlag(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.claims });
    const input = z.object({ claimId: uuid, flagId: uuid, status: z.enum(["cleared", "confirmed", "open"]), note: z.string().trim().max(1000).optional() }).parse(Object.fromEntries(formData));
    const claim = await loadClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    try {
      const r = await reviewFraudFlag(ctx.supabase, { flagId: input.flagId, userId: ctx.userId, status: input.status, note: input.note });
      refresh();
      return { ok: true, message: `Flag ${input.status}. Claim fraud status: ${r.summary.status}.` };
    } catch (e) {
      return apiMessage(e, "We couldn't update that flag.");
    }
  });
}

export async function partnerRerunFraudChecks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.claims });
    const input = z.object({ claimId: uuid }).parse(Object.fromEntries(formData));
    const claim = await loadClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    try {
      const s = await runFraudChecks(claim.id, { notify: false });
      refresh();
      return { ok: true, message: `Checks run: ${s.open_flags} open flag${s.open_flags === 1 ? "" : "s"}, status ${s.status}.` };
    } catch (e) {
      return apiMessage(e, "Fraud checks failed.");
    }
  });
}

export async function partnerAssignJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await partnerContext();
    const input = z
      .object({
        claimId: uuid,
        servicePartnerId: uuid,
        kind: z.enum(["repair", "towing", "treatment", "assessment", "replacement", "other"]).default("repair"),
        directBilling: z.enum(["on", "true", "false"]).optional(),
        estimate: z.string().optional(),
        scheduledFor: z.string().optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .parse(Object.fromEntries(formData));
    const claim = await loadPartnerClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    const estimate = input.estimate?.trim() ? Number(input.estimate) : undefined;
    if (estimate !== undefined && (Number.isNaN(estimate) || estimate < 0)) return { ok: false, error: "Enter a valid estimate." };
    const scheduled = input.scheduledFor?.trim() ? new Date(input.scheduledFor.trim()) : null;
    try {
      const job = await createClaimJob(ctx.supabase, {
        claimId: claim.id,
        userId: ctx.userId,
        servicePartnerId: input.servicePartnerId,
        kind: input.kind,
        directBilling: input.directBilling === "on" || input.directBilling === "true",
        estimate,
        scheduledFor: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled.toISOString() : undefined,
        notes: input.notes,
      });
      refresh();
      return { ok: true, message: `${job.partner.name} assigned. The customer has been told${job.direct_billing ? " — direct billing, no upfront payment" : ""}.` };
    } catch (e) {
      return apiMessage(e, "We couldn't assign that partner.");
    }
  });
}

export async function partnerUpdateJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await partnerContext();
    const input = z.object({ claimId: uuid, jobId: uuid, status: z.enum(["requested", "accepted", "in_progress", "completed", "cancelled"]), notes: z.string().trim().max(2000).optional() }).parse(Object.fromEntries(formData));
    const claim = await loadPartnerClaim(ctx, input.claimId);
    if (!claim) return { ok: false, error: "Claim not found." };
    try {
      await updateClaimJob(ctx.supabase, { jobId: input.jobId, userId: ctx.userId, status: input.status, ...(input.notes ? { notes: input.notes } : {}) });
    } catch (e) {
      return apiMessage(e, "We couldn't update that job.");
    }
    refresh();
    return { ok: true, message: "Job updated." };
  });
}
