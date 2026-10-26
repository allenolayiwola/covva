import { CLAIM_STATUS, ProxyClaimInput } from "@im/core";
import { parseJson, withApi } from "@/server/api-auth";
import { fileProxyClaim } from "@/server/diaspora-claims";

/**
 * POST /api/v1/family/claims — a sponsor reports a claim on a policy they pay for, on behalf of the beneficiary.
 * Needs an active sponsorship and the beneficiary's `proxy_claims` consent (422 otherwise). Reporting is not approval.
 */
export const POST = withApi(
  async ({ auth, req, client }) => {
    const input = await parseJson(req, ProxyClaimInput);
    const r = await fileProxyClaim(auth.supabase, auth.userId, input.policyId, {
      incidentType: input.incidentType,
      incidentAt: input.incidentAt,
      location: input.location ?? null,
      description: input.description,
      amountClaimed: input.amountClaimed ?? null,
      evidence: input.evidence,
      source: client === "mobile" ? "mobile" : "web",
    });
    return Response.json(
      {
        ok: true,
        data: {
          claim: { ...r.claim, statusLabel: CLAIM_STATUS[r.claim.status].label, statusHint: CLAIM_STATUS[r.claim.status].customerHint ?? null },
          beneficiary: r.beneficiary,
          reportedBy: r.reportedBy,
          requiredEvidence: r.requiredEvidence,
          disclaimer: r.disclaimer,
          warnings: r.warnings,
        },
      },
      { status: 201 },
    );
  },
  { auth: "user" },
);
