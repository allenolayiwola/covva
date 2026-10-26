import { CLAIM_STATUS, PartnerClaimsQuery } from "@im/core";
import { check, parseQuery, withApi } from "@/server/api-auth";
import { resolvePartnerOrg } from "@/server/partner-mobile";

const OPEN = ["reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"] as const;
const DECIDED = ["approved", "partially_approved", "rejected", "paid", "closed", "withdrawn"] as const;

/**
 * GET /api/v1/partner/claims — claims the organisation assists (brokers) or decides (insurers), newest first.
 * Filters: `view=open|decided|all`, `status`, `policyId`, `customerId`, cursor `before` (created_at).
 * Insurer users: web client only (platform rule). Keys: scope claims:read.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, PartnerClaimsQuery);
    const p = await resolvePartnerOrg(auth, req, client, { orgId: q.orgId });
    let query = p.db
      .from("claims")
      .select("id, reference, status, incident_type, incident_at, location, amount_claimed, decision_amount, decision_note, insurer_reference, reported_at, delivered_to_insurer_at, acknowledged_at, decision_at, paid_at, customer_id, broker_org_id, insurer_org_id, created_at, updated_at, policy:policies!claims_policy_id_fkey(id, internal_reference, policy_number, nickname, category:product_categories(slug, name))")
      .eq(p.orgType === "broker" ? "broker_org_id" : "insurer_org_id", p.orgId)
      .order("created_at", { ascending: false })
      .limit(q.limit);
    if (q.status) query = query.eq("status", q.status);
    else if (q.view === "open") query = query.in("status", [...OPEN]);
    else if (q.view === "decided") query = query.in("status", [...DECIDED]);
    if (q.policyId) query = query.eq("policy_id", q.policyId);
    if (q.customerId) query = query.eq("customer_id", q.customerId);
    if (q.before) query = query.lt("created_at", q.before);
    const res = await query;
    check(res);
    const rows = res.data ?? [];
    // Customer display names (RLS: the broker of record / insurer can read the profile; insurers see initials only).
    const ids = [...new Set(rows.map((c) => c.customer_id))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await p.db.from("profiles").select("id, full_name, preferred_name, business_name").in("id", ids);
      for (const pr of profiles ?? []) {
        const full = pr.business_name || pr.full_name || pr.preferred_name || "Customer";
        const parts = full.trim().split(/\s+/);
        names.set(pr.id, p.orgType === "insurer" && !pr.business_name && parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : full);
      }
    }
    return {
      items: rows.map((c) => ({ ...c, statusLabel: CLAIM_STATUS[c.status].label, customerName: names.get(c.customer_id) ?? "Customer" })),
      nextCursor: rows.length === q.limit ? rows[rows.length - 1]!.created_at : null,
      disclaimer: "Reporting a claim is not approval. Only the insurer decides claims.",
    };
  },
  { auth: "either", scopes: ["claims:read"] },
);
