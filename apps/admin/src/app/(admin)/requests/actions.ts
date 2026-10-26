"use server";
import { z } from "zod";
import { buildDisclosure, OPEN_REQUEST_STATUSES } from "@im/core";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";

const Reassign = z.object({
  requestId: z.string().uuid(),
  brokerOrgId: z.string().uuid({ error: "Choose the new broker of record" }),
  method: z.enum(["call", "sms", "email", "in_app"]),
  customerNotified: z.literal("on", { error: "Confirm the customer has been told about the change" }),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000),
});

/**
 * Reassign the broker of record. Spec rule: one broker of record per request and
 * the broker cannot change without notice to the customer. The DB trigger blocks
 * the change unless a `broker_change` disclosure for the NEW broker exists, so we
 * record that disclosure first. RLS only lets customers insert disclosures, so the
 * disclosure row (stating how the customer was informed) is a system write.
 */
export async function reassignBroker(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Reassign.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { requestId, brokerOrgId, method, reason } = parsed.data;
  const { supabase, staff } = auth;

  const { data: req } = await supabase.from("requests").select("id, customer_id, broker_org_id, status, reference").eq("id", requestId).single();
  if (!req) return fail("Request not found.");
  if (!OPEN_REQUEST_STATUSES.includes(req.status) && req.status !== "draft") return fail("Only open requests can be reassigned.");
  if (req.broker_org_id === brokerOrgId) return fail("That broker is already the broker of record.");

  const { data: broker } = await supabase.from("organizations").select("id, name, type, status, nic_licence_number").eq("id", brokerOrgId).single();
  if (!broker || broker.type !== "broker") return fail("Choose a broker organisation.");
  if (broker.status !== "active") return fail("The new broker must be active.");

  if (req.broker_org_id) {
    let svc;
    try {
      svc = createServiceClient();
    } catch {
      return fail(
        "Recording the broker-change disclosure needs SUPABASE_SECRET_KEY on the admin app (RLS only lets customers acknowledge disclosures). Ask an engineer to configure it.",
      );
    }
    const { error: dErr } = await svc.from("broker_disclosures").insert({
      request_id: req.id,
      broker_org_id: broker.id,
      shown_to: req.customer_id,
      method,
      stage: "broker_change",
      disclosure_text: `${buildDisclosure({ broker: { name: broker.name, licence: broker.nic_licence_number } })} Your broker of record has changed. Reason: ${reason}`,
    });
    if (dErr) return fail(dbMessage(dErr));
  }

  const { error } = await supabase.from("requests").update({ broker_org_id: broker.id, assigned_to: null }).eq("id", req.id);
  if (error) return fail(dbMessage(error));

  await supabase.from("request_events").insert({
    request_id: req.id,
    actor_id: staff.userId,
    actor_party: "platform",
    event: "broker_reassigned",
    note: `Broker of record changed to ${broker.name}. Customer informed by ${method}. Reason: ${reason}`,
    visible_to_customer: true,
    data: { from_broker_org_id: req.broker_org_id, to_broker_org_id: broker.id, method },
  });
  return done(`${req.reference} reassigned to ${broker.name}.`);
}

const Cancel = z.object({ requestId: z.string().uuid(), reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000) });

export async function cancelRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Cancel.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase, staff } = auth;

  const { data: req } = await supabase.from("requests").select("id, status, reference").eq("id", parsed.data.requestId).single();
  if (!req) return fail("Request not found.");
  if (["completed", "cancelled", "closed_no_cover"].includes(req.status)) return fail("This request is already closed.");
  if (req.status === "policy_documents") return fail("Payment has been confirmed — resolve with the insurer and broker rather than cancelling.");

  const { error } = await supabase.from("requests").update({ status: "cancelled", cancelled_reason: parsed.data.reason }).eq("id", req.id);
  if (error) return fail(dbMessage(error));
  await supabase.from("request_events").insert({
    request_id: req.id,
    actor_id: staff.userId,
    actor_party: "platform",
    event: "note",
    note: `Cancelled by platform operations: ${parsed.data.reason}`,
    visible_to_customer: true,
  });
  return done(`${req.reference} cancelled.`);
}

const Note = z.object({ requestId: z.string().uuid(), note: z.string().trim().min(2).max(2000) });

export async function addInternalNote(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Note.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("request_events").insert({
    request_id: parsed.data.requestId,
    actor_id: auth.staff.userId,
    actor_party: "platform",
    event: "note",
    note: parsed.data.note,
    visible_to_customer: false,
  });
  if (error) return fail(dbMessage(error));
  return done("Internal note added.");
}

const Complete = z.object({ requestId: z.string().uuid(), brokerOrgId: z.string().uuid().optional().or(z.literal("")), reason: z.string().trim().max(1000).optional() });

/**
 * Complete a customer-consented hand-over. The `complete_broker_change` SECURITY DEFINER
 * function re-checks that the caller is platform staff (or the current broker's supervisor),
 * that a `broker_change` disclosure exists for the proposed broker, then moves the request,
 * unassigns it and logs `broker_changed`. Notifications are sent from here.
 */
export async function completeBrokerHandover(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Complete.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase } = auth;
  const { data, error } = await supabase.rpc("complete_broker_change", { p_request: parsed.data.requestId, p_broker_org_id: parsed.data.brokerOrgId || undefined });
  if (error) return fail(dbMessage(error));
  const row = data?.[0];
  if (!row) return fail("The hand-over could not be completed.");
  if (parsed.data.reason) {
    await supabase.from("request_events").insert({ request_id: row.request_id, actor_id: auth.staff.userId, actor_party: "platform", event: "note", note: `Hand-over completed by platform operations: ${parsed.data.reason}`, visible_to_customer: false });
  }
  // Notifications are system writes; skip gracefully without the service key.
  try {
    const svc = createServiceClient();
    const rows = [{ user_id: row.customer_id, kind: "request.broker_changed", title: `${row.to_broker_name} is now your broker for ${row.reference}`, body: "Your request has moved with your consent. Your new broker will pick it up from here.", link: `/account/requests/${row.request_id}`, data: { request_id: row.request_id }, channels: ["in_app", "email", "push"] }];
    const { data: members } = await svc.from("memberships").select("user_id").in("org_id", [row.to_broker_org_id, ...(row.from_broker_org_id ? [row.from_broker_org_id] : [])]).eq("active", true).in("role", ["owner", "admin", "supervisor"]);
    for (const m of members ?? []) rows.push({ user_id: m.user_id, kind: "request.handover", title: `${row.reference} handed over to ${row.to_broker_name}`, body: "Completed by platform operations with the customer's consent.", link: `/partner/requests/${row.request_id}`, data: { request_id: row.request_id }, channels: ["in_app", "email"] });
    await svc.from("notifications").insert(rows);
  } catch {
    // no service key: the change is still recorded and audited
  }
  return done(`${row.reference} handed over to ${row.to_broker_name}.`);
}
