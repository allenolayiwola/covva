import { z } from "zod";
import { POLICY_STATUS } from "@im/core";
import { check, parseQuery, withApi } from "@/server/api-auth";

const Query = z.object({ status: z.enum(["pending_issuance", "active", "lapsed", "cancelled", "expired", "renewed"]).optional() });

/** GET /api/v1/policies — the customer's policy wallet. Cover is active only when status = active. */
export const GET = withApi(
  async ({ auth, req }) => {
    const q = parseQuery(req, Query);
    let query = auth.supabase
      .from("policies")
      .select("id, internal_reference, policy_number, status, nickname, summary, cover_start, cover_end, premium, currency, billing_period, sum_insured, excess, external_source, request_id, created_at, category:product_categories(id, slug, name, icon), insurer:organizations!policies_insurer_org_id_fkey(id, name, logo_url, settings), broker:organizations!policies_broker_org_id_fkey(id, name)")
      .eq("customer_id", auth.userId)
      .order("created_at", { ascending: false });
    if (q.status) query = query.eq("status", q.status);
    const res = await query;
    check(res);
    return (res.data ?? []).map((p) => ({
      ...p,
      statusLabel: p.external_source && p.status === "active" ? "Added by you" : POLICY_STATUS[p.status].label,
      statusHint: POLICY_STATUS[p.status].customerHint ?? null,
      coverActive: p.status === "active" && !p.external_source,
      demo: !!((p.insurer as unknown as { settings: { demo?: boolean } | null } | null)?.settings?.demo),
    }));
  },
  { auth: "user" },
);
