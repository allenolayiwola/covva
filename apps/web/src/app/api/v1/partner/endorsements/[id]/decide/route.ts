import { DecideEndorsementInput } from "@im/core";
import { forbidden, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { decideEndorsement, endorsementView } from "@/server/endorsements";
import { requireRole, resolvePartnerOrg } from "@/server/partner-mobile";

/** POST /api/v1/partner/endorsements/{id}/decide — insurer only: accept or reject the change (scope policies:issue). */
export const POST = withApi(
  async ({ auth, req, client }, route: RouteContext<"/api/v1/partner/endorsements/[id]/decide">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, DecideEndorsementInput);
    const p = await resolvePartnerOrg(auth, req, client, { kinds: ["insurer"] });
    if (p.orgType !== "insurer") throw forbidden("Only the insurer decides a change to cover.");
    requireRole(p, ["owner", "admin", "underwriter"], "Only underwriters decide changes to cover.");
    const e = await decideEndorsement({ insurerOrgId: p.orgId, actorId: p.userId, endorsementId: id, decision: input.decision, note: input.note, premiumAdjustment: input.premiumAdjustment, db: p.db });
    return { endorsement: endorsementView(e) };
  },
  { auth: "either", scopes: ["policies:issue"] },
);
