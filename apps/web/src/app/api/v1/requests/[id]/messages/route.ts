import { after } from "next/server";
import { PostMessageInput } from "@im/core";
import type { Json } from "@im/db";
import { PageQuery, check, invalid, must, parseJson, parseQuery, uuidParam, withApi } from "@/server/api-auth";
import { requestForCaller } from "@/server/access";
import { notify, notifyOrg } from "@/server/notify";

/** GET /api/v1/requests/{id}/messages — threaded broker messages (internal notes hidden from customers by RLS). */
export const GET = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/requests/[id]/messages">) => {
    const id = uuidParam((await route.params).id);
    const q = parseQuery(req, PageQuery);
    const { party } = await requestForCaller(auth, id);
    let query = auth.supabase
      .from("request_messages")
      .select("id, sender_party, sender_id, body, attachments, internal, read_by_customer_at, read_by_broker_at, created_at")
      .eq("request_id", id)
      .order("created_at", { ascending: false })
      .limit(q.limit);
    if (q.before) query = query.lt("created_at", q.before);
    const res = await query;
    check(res);
    const items = (res.data ?? []).reverse();
    after(async () => {
      if (party === "customer") {
        await auth.supabase.from("request_messages").update({ read_by_customer_at: new Date().toISOString() }).eq("request_id", id).neq("sender_party", "customer").is("read_by_customer_at", null);
      } else if (party === "broker") {
        await auth.supabase.from("request_messages").update({ read_by_broker_at: new Date().toISOString() }).eq("request_id", id).eq("sender_party", "customer").is("read_by_broker_at", null);
      }
    });
    return { items, nextCursor: res.data?.length === q.limit ? items[0]!.created_at : null };
  },
  { auth: "user" },
);

/** POST /api/v1/requests/{id}/messages — send a message on the request thread. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/requests/[id]/messages">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, PostMessageInput);
    const { request, party } = await requestForCaller(auth, id);
    if (input.attachments.length) {
      const { data: docs } = await auth.supabase.from("documents").select("id").in("id", input.attachments.map((a) => a.documentId));
      if ((docs?.length ?? 0) !== new Set(input.attachments.map((a) => a.documentId)).size) throw invalid("One or more attachments were not found.");
    }
    const msg = must(await auth.supabase
      .from("request_messages")
      .insert({ request_id: id, sender_id: auth.userId, sender_party: party, body: input.body, attachments: input.attachments as unknown as Json, internal: false })
      .select("id, sender_party, body, attachments, created_at")
      .single());
    const preview = input.body.length > 140 ? `${input.body.slice(0, 137)}…` : input.body;
    if (party === "customer" && request.broker_org_id) {
      await notifyOrg(request.broker_org_id, { kind: "message.new", title: `New message on ${request.reference}`, body: preview, link: `/partner/requests/${id}`, data: { request_id: id, message_id: msg.id }, channels: ["in_app", "push"] });
    } else if (party !== "customer") {
      await notify({ userId: request.customer_id, kind: "message.new", title: `New message about ${request.reference}`, body: preview, link: `/account/requests/${id}`, data: { request_id: id, message_id: msg.id }, channels: ["in_app", "push", "email"] });
    }
    return Response.json({ ok: true, data: msg }, { status: 201 });
  },
  { auth: "user" },
);
