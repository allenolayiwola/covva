import { after } from "next/server";
import { PartnerMessageInput, PartnerMessagesQuery } from "@im/core";
import type { Json } from "@im/db";
import { check, forbidden, invalid, must, parseJson, parseQuery, withApi } from "@/server/api-auth";
import { requestForCaller } from "@/server/access";
import { notify } from "@/server/notify";
import { resolvePartnerOrg } from "@/server/partner-mobile";

/**
 * GET /api/v1/partner/messages?request_id= — the request thread as the servicing organisation sees it
 * (customer messages, replies and internal notes; RLS hides internal notes from customers). Marks the
 * customer's messages read by the broker.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, PartnerMessagesQuery);
    await resolvePartnerOrg(auth, req, client, { orgId: q.orgId });
    const { request, party } = await requestForCaller(auth, q.request_id);
    if (party === "customer") throw forbidden("Use the customer messaging endpoint for your own requests.");
    let query = auth.supabase
      .from("request_messages")
      .select("id, sender_party, sender_id, body, attachments, internal, read_by_customer_at, read_by_broker_at, created_at")
      .eq("request_id", q.request_id)
      .order("created_at", { ascending: false })
      .limit(q.limit);
    if (q.before) query = query.lt("created_at", q.before);
    const res = await query;
    check(res);
    const items = (res.data ?? []).reverse();
    if (party === "broker") {
      after(async () => {
        await auth.supabase.from("request_messages").update({ read_by_broker_at: new Date().toISOString() }).eq("request_id", q.request_id).eq("sender_party", "customer").is("read_by_broker_at", null);
      });
    }
    return { request: { id: request.id, reference: request.reference, status: request.status, customerId: request.customer_id }, items, nextCursor: res.data?.length === q.limit ? items[0]!.created_at : null };
  },
  { auth: "user" },
);

/**
 * POST /api/v1/partner/messages — send a message to the customer on a request the organisation services
 * (push + in-app + email to the customer), or an internal note (`internal: true`, team only).
 */
export const POST = withApi(
  async ({ auth, req, client }) => {
    const input = await parseJson(req, PartnerMessageInput);
    const p = await resolvePartnerOrg(auth, req, client);
    const { request, party } = await requestForCaller(auth, input.requestId);
    if (party === "customer") throw forbidden("Use the customer messaging endpoint for your own requests.");
    if (party === "broker" && request.broker_org_id !== p.orgId) throw forbidden("This request is serviced by another organisation.");
    if (input.attachments.length) {
      const { data: docs } = await auth.supabase.from("documents").select("id").in("id", input.attachments.map((a) => a.documentId));
      if ((docs?.length ?? 0) !== new Set(input.attachments.map((a) => a.documentId)).size) throw invalid("One or more attachments were not found.");
    }
    const msg = must(
      await auth.supabase
        .from("request_messages")
        .insert({ request_id: input.requestId, sender_id: auth.userId, sender_party: party, body: input.body, attachments: input.attachments as unknown as Json, internal: input.internal })
        .select("id, sender_party, body, attachments, internal, created_at")
        .single(),
    );
    if (!input.internal) {
      const preview = input.body.length > 140 ? `${input.body.slice(0, 137)}…` : input.body;
      await notify({
        userId: request.customer_id,
        kind: "message.new",
        title: `New message from ${p.orgName} about ${request.reference}`,
        body: preview,
        link: `/account/requests/${input.requestId}`,
        data: { request_id: input.requestId, message_id: msg.id },
        channels: ["in_app", "push", "email"],
      });
    }
    return Response.json({ ok: true, data: msg }, { status: 201 });
  },
  { auth: "user" },
);
