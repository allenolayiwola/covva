import { IssuePolicyBody } from "@im/core";
import { forbidden, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { issuePolicyForInsurer } from "@/server/policies";

/**
 * POST /api/v1/partner/policies/{id}/issue — insurer API key (scope policies:issue).
 * Activates cover. `issuePolicyForInsurer` verifies the key's org is the policy's insurer
 * before writing with the service client (the trigger trusts the service role).
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/partner/policies/[id]/issue">) => {
    if (auth.orgType !== "insurer") throw forbidden("Only the insurer can issue a policy.");
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, IssuePolicyBody);
    const policy = await issuePolicyForInsurer({ insurerOrgId: auth.orgId, policyId: id, ...input });
    return { policy: { id: policy.id, status: policy.status, policy_number: policy.policy_number, cover_start: policy.cover_start, cover_end: policy.cover_end, issued_at: policy.issued_at } };
  },
  { auth: "apiKey", scopes: ["policies:issue"] },
);
