"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Review = z.object({
  verificationId: z.string().uuid(),
  decision: z.enum(["verified", "rejected"]),
  reason: z.string().trim().max(1000).optional(),
});

/** Approve or reject a KYC verification; mirrors the result onto the customer profile. */
export async function reviewKyc(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Review.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { verificationId, decision, reason } = parsed.data;
  if (decision === "rejected" && (!reason || reason.length < 5)) return fail("Give the reason for rejection (at least 5 characters).");
  const { supabase, staff } = auth;

  const { data: v } = await supabase.from("kyc_verifications").select("id, user_id, status, result").eq("id", verificationId).single();
  if (!v) return fail("Verification not found.");
  if (v.status !== "pending") return fail("This verification has already been reviewed.");

  const now = new Date().toISOString();
  const result = { ...((v.result as Record<string, unknown> | null) ?? {}), review: { decision, reason: reason ?? null, by: staff.userId, at: now } };
  const { error } = await supabase
    .from("kyc_verifications")
    .update({ status: decision, reviewed_by: staff.userId, reviewed_at: now, result })
    .eq("id", v.id);
  if (error) return fail(dbMessage(error));

  const { error: pErr } = await supabase
    .from("profiles")
    .update(decision === "verified" ? { kyc_status: "verified", kyc_verified_at: now } : { kyc_status: "rejected", kyc_verified_at: null })
    .eq("id", v.user_id);
  if (pErr) return fail(`Verification updated, but the profile could not be: ${dbMessage(pErr)}`);
  return done(decision === "verified" ? "Identity verified." : "Verification rejected.");
}
