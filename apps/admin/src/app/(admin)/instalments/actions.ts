"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Input = z.object({ instalmentId: z.string().uuid(), op: z.enum(["retry", "waive"]), reason: z.string().trim().max(500).optional() });

/**
 * Instalment operations (platform ops, staff RLS, audited by trigger). "Retry" schedules one more
 * collection attempt at the next `instalment-collections` run (06:30 / 18:30); "Waive" records an
 * instalment the insurer has agreed to waive (ops never move money themselves). Lapse and
 * reinstatement decisions stay with the insurer.
 */
export async function instalmentOp(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Input.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { instalmentId, op } = parsed.data;
  const now = new Date().toISOString();
  const patch = op === "retry" ? { next_attempt_at: now, attempts: 2, status: "due" } : { status: "waived", next_attempt_at: null };
  const { data, error } = await auth.supabase.from("instalments").update(patch).eq("id", instalmentId).in("status", ["due", "failed"]).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("Instalment not found or already settled.");
  return done(op === "retry" ? "One more collection attempt is scheduled for the next run (06:30 / 18:30)." : "Instalment marked as waived (record the insurer's approval in the notes).");
}
