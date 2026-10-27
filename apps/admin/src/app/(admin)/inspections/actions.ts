"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";

const Assign = z.object({ inspectionId: z.string().uuid(), partnerOrgId: z.string().uuid({ error: "Choose an inspection partner" }) });

/**
 * Assign a property inspection to a partner organisation (`settings.inspection_partner = true`).
 * The row update goes through staff RLS (audited); the partner's owners/admins get an in-app
 * notification (email delivery for this kind is handled by the web app's notification cron).
 */
export async function assignInspection(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Assign.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { inspectionId, partnerOrgId } = parsed.data;
  const { data: org } = await auth.supabase.from("organizations").select("id, name, status, settings").eq("id", partnerOrgId).maybeSingle();
  if (!org || org.status !== "active" || (org.settings as { inspection_partner?: boolean } | null)?.inspection_partner !== true) return fail("Choose an active organisation flagged as an inspection partner (Organisations → settings.inspection_partner).");
  const { data, error } = await auth.supabase.from("property_inspections").update({ partner_org_id: org.id, status: "assigned" }).eq("id", inspectionId).in("status", ["requested", "assigned"]).select("id, address, policy_id, request_id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("This inspection can't be reassigned (already scheduled or completed).");
  try {
    const svc = createServiceClient();
    const { data: members } = await svc.from("memberships").select("user_id, role").eq("org_id", org.id).eq("active", true);
    const userIds = [...new Set((members ?? []).filter((m) => ["owner", "admin", "supervisor"].includes(m.role)).map((m) => m.user_id))];
    if (userIds.length) {
      await svc.from("notifications").insert(userIds.map((user_id) => ({ user_id, kind: "inspection.assigned", title: "New property inspection", body: `${data[0]!.address ?? "Property"} — accept and schedule it in your partner workspace.`, link: "/partner/inspections", data: { inspection_id: inspectionId }, channels: ["in_app", "email"] })));
    }
  } catch (err) {
    console.error("inspection notify failed", err);
  }
  return done(`Assigned to ${org.name}.`);
}
