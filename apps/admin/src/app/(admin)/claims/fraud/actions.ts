"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Review = z.object({
  flagId: z.string().uuid(),
  status: z.enum(["cleared", "confirmed", "open"]),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Clear, confirm or reopen a fraud indicator. The database stamps the reviewer and recomputes
 * claims.fraud_score / fraud_status. Platform staff review flags; they still never decide the claim.
 */
export async function reviewFraudFlag(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Review.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase
    .from("claim_fraud_flags")
    .update({ status: parsed.data.status, review_note: parsed.data.reason || null, reviewed_by: auth.staff.userId })
    .eq("id", parsed.data.flagId);
  if (error) return fail(dbMessage(error));
  return done(`Flag ${parsed.data.status}.`);
}

const Rerun = z.object({ claimId: z.string().uuid() });

export async function rerunFraudChecks(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Rerun.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data, error } = await auth.supabase.rpc("run_claim_fraud_checks", { p_claim_id: parsed.data.claimId });
  if (error) return fail(dbMessage(error));
  const r = (data ?? {}) as { status?: string; open_flags?: number };
  return done(`Checks run: ${r.open_flags ?? 0} open flag(s), status ${r.status ?? "clear"}.`);
}
