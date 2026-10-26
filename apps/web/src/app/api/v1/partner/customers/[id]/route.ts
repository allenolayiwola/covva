import { CLAIM_STATUS, POLICY_STATUS, REQUEST_STATUS } from "@im/core";
import { uuidParam, withApi } from "@/server/api-auth";
import { brokerClient, resolvePartnerOrg } from "@/server/partner-mobile";

/** GET /api/v1/partner/customers/{id} — one client with their policies, requests, claims and assignment history (brokers only). */
export const GET = withApi<"either", RouteContext<"/api/v1/partner/customers/[id]">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "customer");
    const p = await resolvePartnerOrg(auth, req, client, { kinds: ["broker"] });
    const c = await brokerClient(p, id);
    return {
      ...c,
      policies: c.policies.map((x) => ({ ...x, statusLabel: POLICY_STATUS[x.status]?.label ?? x.status })),
      requests: c.requests.map((x) => ({ ...x, statusLabel: REQUEST_STATUS[x.status]?.label ?? x.status })),
      claims: c.claims.map((x) => ({ ...x, statusLabel: CLAIM_STATUS[x.status]?.label ?? x.status })),
    };
  },
  { auth: "either", scopes: ["requests:read"] },
);
