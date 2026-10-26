import { z } from "zod";
import { CreateRequestInput, REQUEST_STATUS } from "@im/core";
import { createRequest } from "@/server/requests";
import { PageQuery, check, parseJson, parseQuery, withApi } from "@/server/api-auth";

const ListQuery = PageQuery.extend({
  status: z.enum(["draft", "submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready", "payment_confirmation", "policy_documents", "completed", "cancelled", "closed_no_cover"]).optional(),
  open: z.enum(["true", "false"]).optional(),
});
const OPEN = ["draft", "submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready", "payment_confirmation", "policy_documents"] as const;

/** GET /api/v1/requests — the signed-in customer's requests, newest first. */
export const GET = withApi(
  async ({ auth, req }) => {
    const q = parseQuery(req, ListQuery);
    let query = auth.supabase
      .from("requests")
      .select("id, reference, status, type, title, next_step, source, due_at, created_at, updated_at, submitted_at, completed_at, category:product_categories(id, slug, name, icon), broker:organizations!requests_broker_org_id_fkey(id, name)")
      .eq("customer_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(q.limit);
    if (q.status) query = query.eq("status", q.status);
    if (q.open === "true") query = query.in("status", [...OPEN]);
    if (q.before) query = query.lt("created_at", q.before);
    const res = await query;
    check(res);
    const items = (res.data ?? []).map((r) => ({ ...r, statusLabel: REQUEST_STATUS[r.status].label, statusHint: REQUEST_STATUS[r.status].customerHint ?? null }));
    return { items, nextCursor: items.length === q.limit ? items[items.length - 1]!.created_at : null };
  },
  { auth: "user" },
);

/** POST /api/v1/requests — create (and by default submit) a request. Routes a broker and prices estimates. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, CreateRequestInput);
    const result = await createRequest(
      {
        categorySlug: input.categorySlug,
        risk: input.risk,
        type: input.type,
        source: "mobile",
        relatedPolicyId: input.relatedPolicyId,
        needsAssessmentId: input.needsAssessmentId,
        submit: input.submit,
        talkToExpert: input.talkToExpert,
      },
      { supabase: auth.supabase, userId: auth.userId },
    );
    return Response.json(
      {
        ok: true,
        data: {
          request: { ...result.request, statusLabel: REQUEST_STATUS[result.request.status].label },
          brokerAssigned: !!result.routing.brokerOrgId,
          routing: { mode: result.routing.mode, reason: result.routing.reason },
          estimates: result.estimates,
        },
      },
      { status: 201 },
    );
  },
  { auth: "user" },
);
