import { SERVICE_PARTNER_KIND_LABELS, ServicePartnersQuery } from "@im/core";
import { createPublicClient } from "@/lib/supabase/server";
import { parseQuery, withApi } from "@/server/api-auth";
import { listServicePartners } from "@/server/claims";

/**
 * GET /api/v1/service-partners?kind=garage&region=Greater%20Accra&insurerOrgId=… — the approved post-claim partner
 * directory (public). `directBilling` is true when the partner settles directly with the given insurer, so the
 * customer does not pay upfront.
 */
export const GET = withApi(
  async ({ auth, req }) => {
    const q = parseQuery(req, ServicePartnersQuery);
    const db = auth?.supabase ?? createPublicClient();
    const items = await listServicePartners(db, { kind: q.kind, region: q.region, insurerOrgId: q.insurerOrgId, q: q.q, limit: q.limit });
    return {
      items: items.map((p) => ({ ...p, kindLabel: SERVICE_PARTNER_KIND_LABELS[p.kind as keyof typeof SERVICE_PARTNER_KIND_LABELS] ?? p.kind })),
      kinds: SERVICE_PARTNER_KIND_LABELS,
    };
  },
  { auth: "optional", clientGate: false },
);
