import { DistributionLeadInput, EMBED_DISCLOSURE } from "@im/core";
import { invalid, parseJson, rule, siteUrl, withApi } from "@/server/api-auth";
import { createDistributionLead } from "@/server/referrals";
import { requireDistributor } from "../_lib";

const ERRORS = {
  unknown_category: "Unknown or unavailable insurance category.",
  partner_inactive: "Your distribution partnership is not active yet.",
  category_not_allowed: "This category is not enabled for your partnership.",
  unknown_code: "That referral code does not belong to your organisation (or is disabled).",
  no_code: "We couldn't create a referral code for your organisation. Contact partnerships@covva.com.gh.",
} as const;

/**
 * POST /api/v1/distribution/leads — hand a consenting customer over to Covva (scope `distribution:lead`).
 * Creates a lead + attribution and sends the customer a link to continue on Covva (SMS and/or email).
 * The partner never collects payment; the customer signs up / signs in on Covva.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    await requireDistributor(auth);
    const input = await parseJson(req, DistributionLeadInput);
    if (Date.parse(input.consent.capturedAt) > Date.now() + 5 * 60_000) throw invalid("consent.capturedAt cannot be in the future.");
    const result = await createDistributionLead(auth.svc, { orgId: auth.orgId, orgName: auth.orgName, ...input, siteUrl: siteUrl() });
    if ("error" in result) throw rule(ERRORS[result.error as keyof typeof ERRORS]);
    return new Response(JSON.stringify({ ok: true, data: { ...result, disclosure: EMBED_DISCLOSURE } }), { status: 201, headers: { "content-type": "application/json" } });
  },
  { auth: "apiKey", scopes: ["distribution:lead"] },
);
