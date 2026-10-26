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
