import { QuoteEndorsementInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { endorsementView, quoteEndorsement } from "@/server/endorsements";
import { PARTNER_ROLES, requireRole, resolvePartnerOrg } from "@/server/partner-mobile";

/** POST /api/v1/partner/endorsements/{id}/quote — broker of record or insurer sets the premium adjustment (scope quotes:write). */
export const POST = withApi(
  async ({ auth, req, client }, route: RouteContext<"/api/v1/partner/endorsements/[id]/quote">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, QuoteEndorsementInput);
    const p = await resolvePartnerOrg(auth, req, client);
    requireRole(p, p.orgType === "insurer" ? ["owner", "admin", "underwriter"] : PARTNER_ROLES.brokerWork, "Your role does not allow quoting changes.");
    const e = await quoteEndorsement({ orgId: p.orgId, actorId: p.userId, endorsementId: id, premiumAdjustment: input.premiumAdjustment, note: input.note, db: p.db });
    return { endorsement: endorsementView(e) };
  },
  { auth: "either", scopes: ["quotes:write"] },
);
