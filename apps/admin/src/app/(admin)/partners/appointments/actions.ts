"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { revalidateEverywhere } from "@/lib/revalidate";

const Decide = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approve", "decline", "revoke"]),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Staff decision on an appointment request: letters for insurers not on Covva (admin_review),
 * or any request on an insurer's behalf. decide_appointment_request() writes the appointment
 * (or deactivates it on revoke) and notifies the broker.
 */
export async function decideAppointmentRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Decide.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.rpc("decide_appointment_request", { p_id: parsed.data.requestId, p_decision: parsed.data.decision, p_note: parsed.data.reason || undefined });
  if (error) return fail(dbMessage(error));
  await revalidateEverywhere(["catalog"]);
  return done(parsed.data.decision === "approve" ? "Appointment approved." : parsed.data.decision === "decline" ? "Request declined." : "Appointment revoked.");
}
