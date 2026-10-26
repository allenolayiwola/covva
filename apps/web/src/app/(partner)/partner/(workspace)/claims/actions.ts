"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { CLAIM_STATUS, formatGHS, type ClaimStatus } from "@im/core";
import { DECIDABLE, INSURER_STEPS } from "../../_lib/claims";
import { notify, notifyOrg } from "@/server/notify";
import { ROLES, actionContext, dbMessage, run, type ActionState, type PartnerContext } from "../../_lib/context";

const uuid = z.string().uuid();


async function loadClaim(ctx: PartnerContext, id: string) {
  const { data } = await ctx.supabase.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id, amount_claimed").eq("id", id).maybeSingle();
  return data && data.insurer_org_id === ctx.orgId ? data : null;
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
