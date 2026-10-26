"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { revalidateEverywhere } from "@/lib/revalidate";

const Id = z.object({ applicationId: z.string().uuid() });

/** Move a submitted application to "in review" (claims it for the reviewer; audited). */
export async function startReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("dueDiligence");
  if (!auth.ok) return fail(auth.error);
  const parsed = Id.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("partner_applications").update({ status: "in_review", reviewed_by: auth.staff.userId, reviewed_at: new Date().toISOString() }).eq("id", parsed.data.applicationId).eq("status", "submitted");
  if (error) return fail(dbMessage(error));
  return done("Application is now in review.");
}

const Approve = z.object({
  applicationId: z.string().uuid(),
  nic_checked: z.literal("on", { error: "Confirm that you checked the licence on the NIC register." }),
  nic_note: z.string().trim().min(5, "Record what you saw on the NIC register (at least 5 characters).").max(2000),
});

/**
 * Approve: records the manual NIC register check (confirmation + note), then
 * approve_partner_application() creates the organisation (licence verified by you), the owner
 * membership, commercial terms and insurer line integrations, and notifies the applicant.
 */
export async function approveApplication(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("dueDiligence");
  if (!auth.ok) return fail(auth.error);
  const parsed = Approve.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const note = `NIC register check confirmed by ${auth.staff.name ?? auth.staff.email ?? "staff"} on ${new Date().toISOString().slice(0, 10)}: ${parsed.data.nic_note}`;
  const { data, error } = await auth.supabase.rpc("approve_partner_application", { p_id: parsed.data.applicationId, p_note: note });
  if (error) return fail(dbMessage(error));
  const row = Array.isArray(data) ? data[0] : null;
  await revalidateEverywhere(["catalog", "partners"]);
  return done(`Approved. Organisation created (${row?.slug ?? "slug pending"}); the applicant has been notified and is its owner.`);
}

const Note = z.object({ applicationId: z.string().uuid(), reason: z.string().trim().min(10, "Tell the applicant what to change (at least 10 characters).").max(4000) });

export async function returnApplication(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("dueDiligence");
  if (!auth.ok) return fail(auth.error);
  const parsed = Note.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.rpc("return_partner_application", { p_id: parsed.data.applicationId, p_note: parsed.data.reason });
  if (error) return fail(dbMessage(error));
  return done("Returned to the applicant with your notes.");
}

export async function rejectApplication(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("dueDiligence");
  if (!auth.ok) return fail(auth.error);
  const parsed = Note.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.rpc("reject_partner_application", { p_id: parsed.data.applicationId, p_note: parsed.data.reason });
  if (error) return fail(dbMessage(error));
  return done("Application rejected; the applicant has been notified.");
}
