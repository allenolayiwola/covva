import { z } from "zod";
import { PartnerOrgQuery } from "@im/core";
import { check, forbidden, parseQuery, withApi } from "@/server/api-auth";
import { canSeeMoney, resolvePartnerOrg } from "@/server/partner-mobile";

const Query = PartnerOrgQuery.extend({ limit: z.coerce.number().int().min(1).max(60).default(24) });

/**
 * GET /api/v1/partner/statements — the organisation's settlement statements, newest period first
 * (owners/admins/finance; keys with finance:read). Premiums never pass through Covva: a statement
 * lists commission earned (brokers) or commission/fees payable (insurers) and the net due.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, Query);
    const p = await resolvePartnerOrg(auth, req, client, { orgId: q.orgId });
    if (!canSeeMoney(auth, p)) throw forbidden("Statements are visible to owners, admins and finance.");
    const res = await p.db
      .from("settlement_statements")
      .select("id, period_start, period_end, currency, gross_premium, commission, platform_fee, net_due, line_count, status, issued_at, paid_at, pdf_path, created_at")
      .eq("org_id", p.orgId)
      .order("period_start", { ascending: false })
      .limit(q.limit);
    check(res);
    return { items: (res.data ?? []).map(({ pdf_path, ...s }) => ({ ...s, hasPdf: !!pdf_path })) };
  },
  { auth: "either", scopes: ["finance:read"] },
);
