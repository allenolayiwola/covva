"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { applyEndorsement, decideEndorsement, quoteEndorsement } from "@/server/endorsements";
import { BusinessRuleError } from "@/server/requests";
import { ROLES, actionContext, run, type ActionState } from "../../_lib/context";

const uuid = z.string().uuid();
const Quote = z.object({ endorsementId: uuid, premiumAdjustment: z.coerce.number().min(-10_000_000).max(10_000_000), note: z.string().trim().max(2000).optional() });
const Decide = z.object({ endorsementId: uuid, decision: z.enum(["accept", "reject"]), note: z.string().trim().max(2000).optional() });
const Apply = z.object({ endorsementId: uuid, note: z.string().trim().max(2000).optional() });

const asState = (err: unknown): ActionState => ({ ok: false, error: err instanceof BusinessRuleError ? err.message : "Something went wrong. Please try again." });

/** Broker of record (advisers and up) or the insurer's underwriters set the premium adjustment. */
export async function quoteChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext();
    const roles = ctx.kind === "insurer" ? ROLES.underwrite : ROLES.brokerWork;
    if (!roles.includes(ctx.role)) return { ok: false, error: "Your role does not allow quoting changes." };
    const p = Quote.safeParse(Object.fromEntries(formData));
    if (!p.success) return { ok: false, error: "Enter the premium adjustment (negative for a refund, 0 for none)." };
    try {
      await quoteEndorsement({ orgId: ctx.orgId, actorId: ctx.userId, endorsementId: p.data.endorsementId, premiumAdjustment: p.data.premiumAdjustment, note: p.data.note, db: ctx.supabase });
    } catch (err) {
      return asState(err);
    }
    refresh();
    return { ok: true, message: "Quote sent. The customer has been asked to agree to it." };
  });
}

/** Insurer only: accept or reject the change (DB trigger enforces this too). */
export async function decideChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const p = Decide.safeParse(Object.fromEntries(formData));
    if (!p.success) return { ok: false, error: "Choose accept or reject." };
    try {
      await decideEndorsement({ insurerOrgId: ctx.orgId, actorId: ctx.userId, endorsementId: p.data.endorsementId, decision: p.data.decision, note: p.data.note, db: ctx.supabase });
    } catch (err) {
      return asState(err);
    }
    refresh();
    return { ok: true, message: p.data.decision === "accept" ? "Change accepted. Apply it to update the policy and documents." : "Change rejected. The customer has been told." };
  });
}

/** Insurer only: apply the accepted change to the policy and regenerate its documents. */
export async function applyChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const p = Apply.safeParse(Object.fromEntries(formData));
    if (!p.success) return { ok: false, error: "Unknown change." };
    let documents = 0;
    let refund: string | null = null;
    try {
      const r = await applyEndorsement({ insurerOrgId: ctx.orgId, actorId: ctx.userId, endorsementId: p.data.endorsementId, note: p.data.note, db: ctx.supabase, insurerName: ctx.orgName });
      documents = r.documents;
      refund = r.refund;
    } catch (err) {
      return asState(err);
    }
    refresh();
    return { ok: true, message: `Policy updated.${documents ? ` ${documents} documents regenerated.` : ""}${refund === "manual" ? " A refund task was created — return the money to the customer and mark it done." : ""}` };
  });
}
