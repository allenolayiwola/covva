"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Toggle = z.object({
  insurerOrgId: z.string().uuid(),
  brokerOrgId: z.string().uuid(),
  categoryId: z.string().uuid(),
  value: z.enum(["true", "false"]),
});

/**
 * Appoint (or withdraw the appointment of) a broker for an insurer in a category.
 * Rows are never deleted — withdrawing sets active = false so history is kept.
 */
export async function toggleAppointment(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Toggle.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { insurerOrgId, brokerOrgId, categoryId, value } = parsed.data;
  const active = value === "true";

  const { data: existing } = await auth.supabase
    .from("insurer_broker_appointments")
    .select("id")
    .eq("insurer_org_id", insurerOrgId)
    .eq("broker_org_id", brokerOrgId)
    .eq("category_id", categoryId)
    .maybeSingle();
  const { error } = existing
    ? await auth.supabase.from("insurer_broker_appointments").update({ active, ends_on: active ? null : new Date().toISOString().slice(0, 10) }).eq("id", existing.id)
    : await auth.supabase.from("insurer_broker_appointments").insert({ insurer_org_id: insurerOrgId, broker_org_id: brokerOrgId, category_id: categoryId, active, starts_on: new Date().toISOString().slice(0, 10) });
  if (error) return fail(dbMessage(error));
  return done(active ? "Broker appointed." : "Appointment withdrawn.");
}

const Ref = z.object({ appointmentId: z.string().uuid(), agreement_reference: z.string().trim().max(200).optional() });

export async function setAgreementReference(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Ref.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase
    .from("insurer_broker_appointments")
    .update({ agreement_reference: parsed.data.agreement_reference || null })
    .eq("id", parsed.data.appointmentId);
  if (error) return fail(dbMessage(error));
  return done("Agreement reference saved.");
}
