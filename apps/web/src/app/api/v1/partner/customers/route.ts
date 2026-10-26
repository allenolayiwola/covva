import { PartnerCustomersQuery } from "@im/core";
import { parseQuery, withApi } from "@/server/api-auth";
import { listBrokerClients, resolvePartnerOrg } from "@/server/partner-mobile";

/**
 * GET /api/v1/partner/customers?q=&limit=&offset= — the broker's clients (Addendum 4 §2): active
 * `customer_broker_assignments` plus customers whose requests or policies name the organisation as broker
 * of record. Broker organisations only; insurer members are refused (and are web-only anyway).
 * Keys: scope requests:read.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, PartnerCustomersQuery);
    const p = await resolvePartnerOrg(auth, req, client, { orgId: q.orgId, kinds: ["broker"] });
    const { items, total } = await listBrokerClients(p, { q: q.q, limit: q.limit, offset: q.offset });
    return { items, total, limit: q.limit, offset: q.offset, nextOffset: q.offset + items.length < total ? q.offset + items.length : null };
  },
  { auth: "either", scopes: ["requests:read"] },
);
