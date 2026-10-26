import { z } from "zod";
import { PageQuery, check, parseQuery, withApi, type ApiKeyAuth, type UserAuth } from "@/server/api-auth";
import { acceptDeepLink, acceptLink } from "@/server/routing";

const Query = PageQuery.extend({
  status: z.enum(["offered", "accepted", "declined", "expired", "withdrawn"]).default("offered"),
});

/**
 * GET /api/v1/partner/offers — requests offered to the broker (Addendum 2 D2/E).
 * Users (mobile/web, broker members): RLS limits rows to their organisations.
 * API keys (scope requests:read): service client scoped to the key's broker organisation.
 * Each item carries the request's risk summary; customer identity is only shared once accepted.
 */
export const GET = withApi(
  async ({ auth, req }) => {
    const q = parseQuery(req, Query);
    const db = auth.kind === "apiKey" ? (auth as ApiKeyAuth).svc : (auth as UserAuth).supabase;
    let query = db
      .from("order_offers")
      .select("id, request_id, broker_org_id, status, round, offered_at, responds_by, responded_at, decline_reason, accept_token, request:requests!order_offers_request_id_fkey(id, reference, title, type, status, risk_data, talk_to_expert, complexity_flags, created_at, category:product_categories(slug, name))")
      .eq("status", q.status)
      .order("responds_by", { ascending: q.status === "offered" })
      .limit(q.limit);
    if (auth.kind === "apiKey") query = query.eq("broker_org_id", (auth as ApiKeyAuth).orgId);
    if (q.before) query = query.lt("offered_at", q.before);
    const res = await query;
    check(res);
    const rows = res.data ?? [];
    return {
      items: rows.map(({ accept_token, ...o }) => ({
        ...o,
        acceptUrl: o.status === "offered" ? acceptLink(accept_token) : null,
        deepLink: o.status === "offered" ? acceptDeepLink(accept_token) : null,
      })),
      nextCursor: rows.length === q.limit ? rows[rows.length - 1]!.offered_at : null,
    };
  },
  { auth: "either", scopes: ["requests:read"] },
);
