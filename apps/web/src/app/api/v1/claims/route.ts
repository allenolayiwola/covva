import { CLAIM_STATUS, ReportClaimInput } from "@im/core";
import { check, parseJson, withApi } from "@/server/api-auth";
import { createClaim } from "@/server/claims";

/** GET /api/v1/claims — the customer's claims. */
export const GET = withApi(
  async ({ auth }) => {
    const res = await auth.supabase
      .from("claims")
      .select("id, reference, status, incident_type, incident_at, amount_claimed, reported_at, delivered_to_insurer_at, decision_at, created_at, policy:policies!claims_policy_id_fkey(id, internal_reference, policy_number, nickname, category:product_categories(name, slug))")
      .eq("customer_id", auth.userId)
      .order("created_at", { ascending: false });
    check(res);
    return (res.data ?? []).map((c) => ({ ...c, statusLabel: CLAIM_STATUS[c.status].label, statusHint: CLAIM_STATUS[c.status].customerHint ?? null }));
  },
  { auth: "user" },
);

/**
 * POST /api/v1/claims — report a claim to the broker. Reporting is not approval; the insurer decides.
 * Optional `location` may be `{ lat, lng, address }` from the phone; `policeReportDocumentId` links an upload.
 * Attach photos/videos afterwards with `/documents` (claimId) or `/claims/{id}/video`.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, ReportClaimInput);
    const r = await createClaim(auth.supabase, {
      policyId: input.policyId,
      customerId: auth.userId,
      incidentType: input.incidentType,
      incidentAt: input.incidentAt,
      location: input.location ?? null,
      description: input.description,
      amountClaimed: input.amountClaimed ?? null,
      policeReportDocumentId: input.policeReportDocumentId ?? null,
      source: "mobile",
    });
    return Response.json(
      {
        ok: true,
        data: {
          claim: { ...r.claim, statusLabel: CLAIM_STATUS[r.claim.status].label, statusHint: CLAIM_STATUS[r.claim.status].customerHint ?? null },
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
