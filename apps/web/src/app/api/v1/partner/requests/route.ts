import { z } from "zod";
import { REQUEST_STATUS } from "@im/core";
import { PageQuery, check, parseQuery, withApi } from "@/server/api-auth";

const Query = PageQuery.extend({
  status: z.enum(["submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready", "payment_confirmation", "policy_documents", "completed", "cancelled", "closed_no_cover"]).optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
});

/**
 * GET /api/v1/partner/requests — API key (scope requests:read).
 * Brokers: requests routed to them (incl. customer contact details, as servicing broker).
 * Insurers: requests submitted to them (risk data only — no customer contact details).
 * Service client, scoped to the key's organisation in every query.
 */
export const GET = withApi(
  async ({ auth, req }) => {
    const q = parseQuery(req, Query);
    const svc = auth.svc;
    const fields = "id, reference, status, type, title, risk_data, due_at, next_step, created_at, updated_at, category:product_categories(slug, name)";
    if (auth.orgType === "broker") {
      let query = svc.from("requests").select(`${fields}, customer_id`).eq("broker_org_id", auth.orgId).order("updated_at", { ascending: false }).limit(q.limit);
      if (q.status) query = query.eq("status", q.status);
      if (q.updatedSince) query = query.gte("updated_at", q.updatedSince);
      if (q.before) query = query.lt("updated_at", q.before);
      const res = await query;
      check(res);
      const rows = res.data ?? [];
      const { data: profiles } = rows.length
        ? await svc.from("profiles").select("id, full_name, email, phone, account_type, business_name").in("id", [...new Set(rows.map((r) => r.customer_id))])
        : { data: [] };
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      return {
        items: rows.map(({ customer_id, ...r }) => ({ ...r, statusLabel: REQUEST_STATUS[r.status].label, customer: byId.get(customer_id) ?? null })),
        nextCursor: rows.length === q.limit ? rows[rows.length - 1]!.updated_at : null,
      };
    }
    let query = svc
      .from("insurer_submissions")
      .select(`id, status, channel, sent_at, response_due_at, responded_at, external_reference, updated_at, request:requests!insurer_submissions_request_id_fkey(${fields})`)
      .eq("insurer_org_id", auth.orgId)
      .order("updated_at", { ascending: false })
      .limit(q.limit);
    if (q.updatedSince) query = query.gte("updated_at", q.updatedSince);
    if (q.before) query = query.lt("updated_at", q.before);
    const res = await query;
    check(res);
    const rows = res.data ?? [];
    return {
      items: rows
        .map((s) => ({ submission: { ...s, request: undefined }, request: s.request }))
        .filter((x) => !q.status || (x.request as unknown as { status: string } | null)?.status === q.status),
      nextCursor: rows.length === q.limit ? rows[rows.length - 1]!.updated_at : null,
    };
  },
  { auth: "apiKey", scopes: ["requests:read"] },
);
