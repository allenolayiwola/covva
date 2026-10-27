import { ApplyEndorsementInput } from "@im/core";
import { forbidden, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { applyEndorsement, endorsementView } from "@/server/endorsements";
import { requireRole, resolvePartnerOrg } from "@/server/partner-mobile";

/**
 * POST /api/v1/partner/endorsements/{id}/apply — insurer only (scope policies:issue): updates the policy
 * (insured items, sum insured, premium), regenerates its documents and notifies the customer, sponsor and broker.
 */
export const POST = withApi(
  async ({ auth, req, client }, route: RouteContext<"/api/v1/partner/endorsements/[id]/apply">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, ApplyEndorsementInput);
    const p = await resolvePartnerOrg(auth, req, client, { kinds: ["insurer"] });
    if (p.orgType !== "insurer") throw forbidden("Only the insurer applies a change to cover.");
    requireRole(p, ["owner", "admin", "underwriter"], "Only underwriters apply changes to cover.");
    const r = await applyEndorsement({ insurerOrgId: p.orgId, actorId: p.userId, endorsementId: id, note: input.note, db: p.db, insurerName: p.orgName });
    return { endorsement: endorsementView(r.endorsement), documents: r.documents, refund: r.refund };
  },
  { auth: "either", scopes: ["policies:issue"] },
);
