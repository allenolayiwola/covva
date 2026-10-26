"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { notifyOrg } from "@/server/notify";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

const uuid = z.string().uuid();

/** Broker owner/admin asks an insurer on Covva to appoint it for a product line (decided in the insurer portal). */
export async function requestAppointment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.orgAdmin });
    const input = z.object({ insurerOrgId: uuid, categoryId: uuid }).parse({ insurerOrgId: fd.get("insurerOrgId"), categoryId: fd.get("categoryId") });
    const { data: insurer } = await ctx.supabase.from("organizations").select("id, name, status").eq("id", input.insurerOrgId).eq("type", "insurer").maybeSingle();
    if (!insurer || insurer.status !== "active") return { ok: false, error: "That insurer is not live on Covva. Upload an appointment letter instead." };
    const { error } = await ctx.supabase.from("appointment_requests").insert({ broker_org_id: ctx.orgId, insurer_org_id: input.insurerOrgId, category_id: input.categoryId, status: "pending" });
    if (error) {
      if (error.code === "23505") return { ok: false, error: "There is already an open request or an active appointment for this insurer and line." };
      return { ok: false, error: dbMessage(error, "We couldn't send the request.") };
    }
    const { data: cat } = await ctx.supabase.from("product_categories").select("name").eq("id", input.categoryId).maybeSingle();
    await notifyOrg(
      input.insurerOrgId,
      {
        kind: "appointment.requested",
        title: `${ctx.orgName} requests an appointment for ${cat?.name ?? "a product line"}`,
        body: "Approve or decline the request in Appointments. Approved brokers become eligible for your orders in that line immediately.",
        link: "/partner/appointments",
        data: { broker_org_id: ctx.orgId, category_id: input.categoryId },
        channels: ["in_app", "email"],
      },
      ["owner", "admin"],
    ).catch(() => {});
    refresh();
    return { ok: true, message: `Request sent to ${insurer.name}. You'll be notified when they decide.` };
  });
}

const Letter = z.object({
  proposedInsurerName: z.string().trim().min(2, "Enter the insurer's name").max(160),
  categoryId: uuid,
  letterPath: z.string().min(1, "Upload the appointment letter").max(500),
  contactEmail: z.string().trim().toLowerCase().max(200).optional().or(z.literal("")),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * Insurer not on Covva: the broker uploads its appointment letter for staff review and the
 * insurer becomes a partnerships lead ("suggest an insurer", Addendum 3 C2).
 */
export async function requestAppointmentWithLetter(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.orgAdmin });
    const parsed = Letter.safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
    const v = parsed.data;
    if (!v.letterPath.startsWith(`appointment-letters/${ctx.orgId}/`)) return { ok: false, error: "The letter must be uploaded to your organisation's folder." };
    const { data: existing } = await ctx.supabase.from("organizations").select("id, name").eq("type", "insurer").eq("status", "active").ilike("name", v.proposedInsurerName).limit(1).maybeSingle();
    if (existing) return { ok: false, error: `${existing.name} is live on Covva — request the appointment directly instead.` };
    const { error } = await ctx.supabase.from("appointment_requests").insert({
      broker_org_id: ctx.orgId,
      insurer_org_id: null,
      proposed_insurer_name: v.proposedInsurerName,
      category_id: v.categoryId,
      appointment_letter_path: v.letterPath,
      status: "admin_review",
    });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't record the request.") };
    // Partnerships lead: the broker suggests an insurer not yet on Covva.
    const { data: cat } = await ctx.supabase.from("product_categories").select("slug, name").eq("id", v.categoryId).maybeSingle();
    await ctx.supabase.from("leads").insert({
      kind: "insurer",
      name: v.proposedInsurerName,
      organization: v.proposedInsurerName,
      email: v.contactEmail || null,
      category_slug: cat?.slug ?? null,
      message: `Suggested by broker ${ctx.orgName} (appointment letter uploaded for ${cat?.name ?? "a product line"}).${v.note ? ` ${v.note}` : ""}`,
      source_page: "/partner/appointments",
      status: "new",
      tags: ["broker_suggestion"],
      metadata: { broker_org_id: ctx.orgId, category_id: v.categoryId, letter_path: v.letterPath },
    });
    refresh();
    return { ok: true, message: "Letter received. Covva will verify it and our partnerships team will contact the insurer." };
  });
}

/** Insurer owner/admin approves, declines or revokes; the RPC enforces the role and writes the appointment. */
export async function decideAppointment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.orgAdmin });
    const input = z.object({ requestId: uuid, decision: z.enum(["approve", "decline", "revoke"]), note: z.string().trim().max(1000).optional() }).parse({
      requestId: fd.get("requestId"),
      decision: fd.get("decision"),
      note: fd.get("note") ?? undefined,
    });
    const { data, error } = await ctx.supabase.rpc("decide_appointment_request", { p_id: input.requestId, p_decision: input.decision, p_note: input.note || undefined });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't record the decision.") };
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.broker_org_id) {
      // In-app rows are written by the RPC; email the broker's admins too.
      const { data: cat } = await ctx.supabase.from("product_categories").select("name").eq("id", row.category_id).maybeSingle();
      await notifyOrg(
        row.broker_org_id,
        {
          kind: "appointment.decided.email",
          title: `${ctx.orgName} ${input.decision === "approve" ? "approved" : input.decision === "decline" ? "declined" : "revoked"} your appointment for ${cat?.name ?? "a product line"}`,
          body: input.note || (input.decision === "revoke" ? "You are no longer eligible for new orders for this insurer and line." : undefined),
          link: "/partner/appointments",
          data: { request_id: input.requestId, decision: input.decision },
          channels: ["email"],
        },
        ["owner", "admin"],
      ).catch(() => {});
    }
    refresh();
    return { ok: true, message: input.decision === "approve" ? "Broker appointed for this line." : input.decision === "decline" ? "Request declined." : "Appointment revoked — the broker is no longer eligible for new orders in this line." };
  });
}
