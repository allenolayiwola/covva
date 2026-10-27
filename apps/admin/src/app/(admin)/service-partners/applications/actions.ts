"use server";
import { z } from "zod";
import { revalidateEverywhere } from "@/lib/revalidate";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Decide = z.object({ applicationId: z.string().uuid(), decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(1000).optional(), publish: z.string().optional() });

/**
 * Review a self-onboarding application. Approval creates the service_partners row (approved and
 * published, or pending when "publish now" is unticked) and links it; rejection keeps the application
 * with the reason. Nothing is deleted.
 */
export async function decideApplication(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Decide.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { applicationId, decision, reason } = parsed.data;
  const { data: app } = await auth.supabase.from("service_partner_applications").select("*").eq("id", applicationId).maybeSingle();
  if (!app) return fail("Application not found.");
  if (app.status !== "submitted") return fail(`This application was already ${app.status}.`);
  const now = new Date().toISOString();
  if (decision === "reject") {
    if (!reason || reason.length < 5) return fail("Give the reason for rejecting (at least 5 characters).");
    const { error } = await auth.supabase.from("service_partner_applications").update({ status: "rejected", reviewed_by: auth.staff.userId, reviewed_at: now, review_note: reason }).eq("id", app.id).eq("status", "submitted");
    if (error) return fail(dbMessage(error));
    return done("Application rejected.");
  }
  const contacts = (app.contacts ?? {}) as { phone?: string; email?: string | null; contact_name?: string };
  const publish = parsed.data.publish === "on" || parsed.data.publish === "true";
  const { data: partner, error: pErr } = await auth.supabase
    .from("service_partners")
    .insert({
      kind: app.kind,
      name: app.name,
      phone: contacts.phone ?? null,
      email: contacts.email || null,
      address: app.address,
      region: app.region,
      services: app.services ?? [],
      status: publish ? "approved" : "pending",
      notes: [`Self-onboarded via application ${app.id.slice(0, 8)} (contact: ${contacts.contact_name ?? "—"}).`, reason].filter(Boolean).join("\n"),
      created_by: auth.staff.userId,
    })
    .select("id")
    .single();
  if (pErr || !partner) return fail(dbMessage(pErr));
  const { error } = await auth.supabase.from("service_partner_applications").update({ status: "approved", reviewed_by: auth.staff.userId, reviewed_at: now, review_note: reason ?? null, service_partner_id: partner.id }).eq("id", app.id);
  if (error) return fail(dbMessage(error));
  if (publish) await revalidateEverywhere(["service-partners"]);
  return done(publish ? "Approved and published to the directory. Add direct-billing insurers on the partner record." : "Approved. The partner is pending — approve it on the Service partners page to publish.");
}
