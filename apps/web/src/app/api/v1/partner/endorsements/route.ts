import { PartnerEndorsementsQuery } from "@im/core";
import { check, parseQuery, withApi } from "@/server/api-auth";
import { endorsementView } from "@/server/endorsements";
import { resolvePartnerOrg } from "@/server/partner-mobile";

const OPEN = ["submitted", "quoted", "accepted"];

/**
 * GET /api/v1/partner/endorsements — policy changes for the broker of record or the insurer (users: RLS;
 * API keys: scoped to the key's organisation, scope policies:read). `status=open` (default) or one status.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, PartnerEndorsementsQuery);
    const p = await resolvePartnerOrg(auth, req, client, { orgId: q.orgId });
    let query = p.db.from("endorsements").select("*").or(`insurer_org_id.eq.${p.orgId},broker_org_id.eq.${p.orgId}`).order("updated_at", { ascending: false }).limit(q.limit);
    query = q.status === "open" ? query.in("status", OPEN) : query.eq("status", q.status);
    const res = await query;
    check(res);
    return { items: (res.data ?? []).map((e) => ({ ...endorsementView(e), customerId: e.customer_id, party: e.insurer_org_id === p.orgId ? "insurer" : "broker" })) };
  },
  { auth: "either", scopes: ["policies:read"] },
);
