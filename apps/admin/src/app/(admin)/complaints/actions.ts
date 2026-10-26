"use server";
import { z } from "zod";
import type { Enum } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";

const uuidOrEmpty = z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null);

/**
 * complaint_events has no insert policy (it is written by the status trigger). Notes
 * attached to a staff action are a system write, so they use the service client when
 * configured; without it the status change still happens and is audited.
 */
async function addEventNote(complaintId: string, actorId: string, note: string, to?: Enum<"complaint_status">) {
  try {
    const svc = createServiceClient();
    await svc.from("complaint_events").insert({ complaint_id: complaintId, actor_id: actorId, actor_party: "platform", note, to_status: to ?? null });
    return true;
  } catch {
    return false;
  }
}

const Assign = z.object({ complaintId: z.string().uuid(), ownerOrgId: uuidOrEmpty, assignedTo: uuidOrEmpty });

export async function assignComplaint(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Assign.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase
    .from("complaints")
    .update({ owner_org_id: parsed.data.ownerOrgId, assigned_to: parsed.data.assignedTo })
    .eq("id", parsed.data.complaintId);
  if (error) return fail(dbMessage(error));
  return done("Complaint ownership updated.");
}

const Status = z.object({
  complaintId: z.string().uuid(),
  status: z.enum(["acknowledged", "investigating", "resolved", "closed", "open"]),
  reason: z.string().trim().min(5, "Add a note (at least 5 characters)").max(2000),
  outcome: z.string().trim().max(4000).optional(),
});

export async function setComplaintStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Status.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { complaintId, status, reason, outcome } = parsed.data;
  if ((status === "resolved" || status === "closed") && !outcome) return fail("Record the outcome before resolving or closing a complaint.");

  const now = new Date().toISOString();
  const patch: { status: Enum<"complaint_status">; acknowledged_at?: string; resolved_at?: string | null; outcome?: string } = { status };
  if (status === "acknowledged") patch.acknowledged_at = now;
  if (status === "resolved") patch.resolved_at = now;
  if (status === "open" || status === "investigating") patch.resolved_at = null;
  if (outcome) patch.outcome = outcome;

  const { error } = await auth.supabase.from("complaints").update(patch).eq("id", complaintId);
  if (error) return fail(dbMessage(error));
  const noted = await addEventNote(complaintId, auth.staff.userId, reason);
  return done(`Status set to ${status.replace("_", " ")}.${noted ? "" : " (Note not stored: SUPABASE_SECRET_KEY missing — change is still audited.)"}`);
}

const Escalate = z.object({ complaintId: z.string().uuid(), reason: z.string().trim().min(5).max(2000) });

/** Flag a complaint as escalated to the National Insurance Commission. */
export async function escalateToNic(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Escalate.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase
    .from("complaints")
    .update({ status: "escalated_nic", escalated_at: new Date().toISOString() })
    .eq("id", parsed.data.complaintId);
  if (error) return fail(dbMessage(error));
  const noted = await addEventNote(parsed.data.complaintId, auth.staff.userId, `Escalated to NIC: ${parsed.data.reason}`);
  return done(`Flagged as escalated to NIC.${noted ? "" : " (Note not stored: SUPABASE_SECRET_KEY missing.)"}`);
}

const Due = z.object({ complaintId: z.string().uuid(), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(5).max(1000) });

export async function changeComplaintDue(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Due.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase
    .from("complaints")
    .update({ due_at: new Date(`${parsed.data.dueAt}T17:00:00Z`).toISOString() })
    .eq("id", parsed.data.complaintId);
  if (error) return fail(dbMessage(error));
  await addEventNote(parsed.data.complaintId, auth.staff.userId, `Due date changed to ${parsed.data.dueAt}: ${parsed.data.reason}`);
  return done("Due date updated.");
}
