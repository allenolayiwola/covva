"use server";
import { z } from "zod";
import type { Json } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Update = z.object({
  leadId: z.string().uuid(),
  status: z.enum(["new", "contacted", "qualified", "closed"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Update a lead's status and append a staff note. The leads table has no notes
 * column yet, so notes are appended to `utm._admin_notes` (see report: add a
 * proper `notes` column in a future migration).
 */
export async function updateLead(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("leads");
  if (!auth.ok) return fail(auth.error);
  const parsed = Update.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data: lead } = await auth.supabase.from("leads").select("utm").eq("id", parsed.data.leadId).single();
  if (!lead) return fail("Lead not found.");
  const utm = (lead.utm as Record<string, Json> | null) ?? {};
  const notes = Array.isArray(utm._admin_notes) ? utm._admin_notes : [];
  const nextUtm = parsed.data.note
    ? { ...utm, _admin_notes: [...notes, { note: parsed.data.note, by: auth.staff.userId, by_name: auth.staff.name ?? auth.staff.email, at: new Date().toISOString(), status: parsed.data.status }] }
    : utm;
  const { error } = await auth.supabase.from("leads").update({ status: parsed.data.status, utm: nextUtm }).eq("id", parsed.data.leadId);
  if (error) return fail(dbMessage(error));
  return done("Lead updated.");
}
