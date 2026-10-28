"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { decideReinstatement } from "@/server/instalments";
import { BusinessRuleError } from "@/server/requests";
import { ROLES, actionContext, run, type ActionState } from "../../_lib/context";

/** Insurer decision on a reinstatement its plan sends for review (approve → cover resumes; decline → arrears refunded). */
export async function decideReinstatementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = z.object({ scheduleId: z.string().uuid(), decision: z.enum(["approve", "decline"]), note: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "Check the form" };
    try {
      await decideReinstatement(parsed.data.scheduleId, { approve: parsed.data.decision === "approve", actorId: ctx.userId, note: parsed.data.note ?? null, insurerOrgId: ctx.orgId });
    } catch (err) {
      if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
      throw err;
    }
    refresh();
    return { ok: true, message: parsed.data.decision === "approve" ? "Reinstated. The customer has been told." : "Declined. The arrears are being refunded." };
  });
}
