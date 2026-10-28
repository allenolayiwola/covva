"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { CLAIM_STATUS, COMPLAINT_STATUS } from "@im/core";
import type { Enum } from "@im/db";
import { notify, notifyOrg } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

const uuid = z.string().uuid();

/**
 * Broker claim assistance. Brokers can confirm delivery to the insurer and, only while the
 * insurer hasn't acted yet, record acknowledgement/assessment steps. Decisions are insurer-only
 * (enforced by the claims_guard trigger).
 */
export async function brokerClaimStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
    const input = z
      .object({ claimId: uuid, to: z.enum(["delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"]), note: z.string().max(2000).optional() })
      .parse(Object.fromEntries(formData));
    const { data: claim } = await ctx.supabase.from("claims").select("id, reference, status, customer_id, insurer_org_id, broker_org_id").eq("id", input.claimId).maybeSingle();
    if (!claim || claim.broker_org_id !== ctx.orgId) return { ok: false, error: "Claim not found." };

    if (input.to !== "delivered_to_insurer") {
      const { data: insurerEvents } = await ctx.supabase.from("claim_events").select("id").eq("claim_id", claim.id).eq("actor_party", "insurer").limit(1);
      if (insurerEvents?.length) return { ok: false, error: "The insurer is handling this claim now. Status updates come from them." };
    } else if (!["reported", "draft"].includes(claim.status)) {
      return { ok: false, error: "This claim has already been delivered to the insurer." };
    }
    const { error } = await ctx.supabase.from("claims").update({ status: input.to }).eq("id", claim.id);
    if (error) return { ok: false, error: dbMessage(error) };
    if (input.note?.trim()) {
      await ctx.supabase.from("claim_events").insert({ claim_id: claim.id, actor_id: ctx.userId, actor_party: "broker", note: input.note.trim(), visible_to_customer: true });
    }
    await notify({
      userId: claim.customer_id,
      kind: "claim.status",
      title: `Claim ${claim.reference}: ${CLAIM_STATUS[input.to].label}`,
      body: input.note?.trim() || CLAIM_STATUS[input.to].customerHint || "Reporting a claim does not mean approval. The insurer decides.",
      link: `/account/claims/${claim.id}`,
      data: { claim_id: claim.id },
    });
    if (input.to === "delivered_to_insurer") {
      await notifyOrg(claim.insurer_org_id, { kind: "claim.delivered", title: `Claim ${claim.reference} delivered by ${ctx.orgName}`, link: `/partner/claims/${claim.id}` }, ["owner", "admin", "claims_officer"]);
    }
    const changed = { claim_id: claim.id, reference: claim.reference, from_status: claim.status, status: input.to };
    await emitEvent(ctx.orgId, "claim.status_changed", changed);
    await emitEvent(claim.insurer_org_id, "claim.status_changed", changed);
    refresh();
    return { ok: true, message: `Claim moved to ${CLAIM_STATUS[input.to].label}.` };
  });
}

export async function deliverClaimEvidence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
    const input = z.object({ claimId: uuid }).parse(Object.fromEntries(formData));
    const { data: claim } = await ctx.supabase.from("claims").select("id, broker_org_id").eq("id", input.claimId).maybeSingle();
    if (!claim || claim.broker_org_id !== ctx.orgId) return { ok: false, error: "Claim not found." };
    const { error, count } = await ctx.supabase
      .from("documents")
      .update({ delivered_to_insurer_at: new Date().toISOString() }, { count: "exact" })
      .eq("claim_id", claim.id)
      .is("delivered_to_insurer_at", null);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: count ? `${count} document${count === 1 ? "" : "s"} recorded as delivered to the insurer.` : "Nothing new to deliver." };
  });
}

const COMPLAINT_OPS: Record<string, { to: Enum<"complaint_status">; needs?: "outcome" | "note" }> = {
  acknowledge: { to: "acknowledged" },
  investigate: { to: "investigating" },
  resolve: { to: "resolved", needs: "outcome" },
  escalate: { to: "escalated_nic", needs: "note" },
  close: { to: "closed" },
};

export async function complaintAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ["owner", "admin", "supervisor", "adviser"] });
    const input = z.object({ complaintId: uuid, op: z.enum(["acknowledge", "investigate", "resolve", "escalate", "close"]), text: z.string().max(4000).optional() }).parse(Object.fromEntries(formData));
    const op = COMPLAINT_OPS[input.op]!;
    const text = input.text?.trim();
    if (op.needs && !text) return { ok: false, error: op.needs === "outcome" ? "Write the outcome you are giving the customer." : "Explain why this is escalated." };
    const { data: c } = await ctx.supabase.from("complaints").select("id, reference, status, customer_id, owner_org_id").eq("id", input.complaintId).maybeSingle();
    if (!c || c.owner_org_id !== ctx.orgId) return { ok: false, error: "Complaint not found." };
    if (c.status === "closed") return { ok: false, error: "This complaint is closed." };
    const now = new Date().toISOString();
    const patch: { status: Enum<"complaint_status">; acknowledged_at?: string; resolved_at?: string; outcome?: string; escalated_at?: string; assigned_to?: string } = { status: op.to };
    if (op.to === "acknowledged") { patch.acknowledged_at = now; patch.assigned_to = ctx.userId; }
    if (op.to === "resolved") { patch.resolved_at = now; patch.outcome = text; }
    if (op.to === "escalated_nic") { patch.escalated_at = now; patch.outcome = text; }
    const { error } = await ctx.supabase.from("complaints").update(patch).eq("id", c.id);
    if (error) return { ok: false, error: dbMessage(error) };
    await notify({
      userId: c.customer_id,
      kind: "complaint.status",
      title: `Complaint ${c.reference}: ${COMPLAINT_STATUS[op.to].label}`,
      body: op.to === "resolved" ? text : op.to === "escalated_nic" ? "Your complaint has been referred to the National Insurance Commission process." : undefined,
      link: `/account/complaints/${c.id}`,
      data: { complaint_id: c.id },
    });
    refresh();
    return { ok: true, message: `Complaint ${COMPLAINT_STATUS[op.to].label.toLowerCase()}.` };
  });
}
