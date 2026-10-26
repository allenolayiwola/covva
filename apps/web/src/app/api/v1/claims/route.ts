import { CLAIM_DISCLAIMER, CLAIM_STATUS, ReportClaimInput } from "@im/core";
import type { Json } from "@im/db";
import { check, must, parseJson, rule, withApi } from "@/server/api-auth";
import { requiredEvidence } from "@/server/claims";
import { notify, notifyOrg } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";

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

/** POST /api/v1/claims — report a claim to the broker. Reporting is not approval; the insurer decides. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, ReportClaimInput);
    const sb = auth.supabase;
    const policy = must(
      await sb.from("policies").select("id, customer_id, status, insurer_org_id, broker_org_id, external_source, cover_start, cover_end, internal_reference, policy_number, category:product_categories(slug)").eq("id", input.policyId).maybeSingle(),
      "Policy not found.",
    );
    if (policy.customer_id !== auth.userId) throw rule("Only the policyholder can report a claim here.");
    if (policy.external_source || !policy.insurer_org_id) throw rule("For a policy you added yourself, contact the insurer that issued it to make a claim.");
    if (policy.status === "pending_issuance") throw rule("This policy hasn't been issued by the insurer yet, so there is no cover to claim against. Contact your broker.");
    if (["cancelled"].includes(policy.status)) throw rule("This policy was cancelled. Contact your broker if you think this is wrong.");

    const slug = (policy.category as unknown as { slug: string } | null)?.slug ?? "other";
    const evidence = requiredEvidence(slug, input.incidentType);
    const claim = must(
      await sb
        .from("claims")
        .insert({
          policy_id: policy.id,
          customer_id: auth.userId,
          insurer_org_id: policy.insurer_org_id,
          broker_org_id: policy.broker_org_id,
          status: "reported",
          incident_type: input.incidentType,
          incident_at: new Date(input.incidentAt).toISOString(),
          location: input.location ?? null,
          description: input.description,
          amount_claimed: input.amountClaimed ?? null,
          required_evidence: evidence as unknown as Json,
        })
        .select("id, reference, status, incident_type, incident_at, reported_at, created_at")
        .single(),
    );
    const outsideCover = !!(policy.cover_start && policy.cover_end && (input.incidentAt.slice(0, 10) < policy.cover_start || input.incidentAt.slice(0, 10) > policy.cover_end));
    if (policy.broker_org_id) {
      await notifyOrg(policy.broker_org_id, { kind: "claim.reported", title: `Claim ${claim.reference} reported`, body: `${input.incidentType} on ${policy.policy_number ?? policy.internal_reference}. Check the evidence and deliver it to the insurer.`, link: `/partner/claims/${claim.id}`, data: { claim_id: claim.id } });
    }
    await notify({ userId: auth.userId, kind: "claim.reported", title: `Claim ${claim.reference} reported to your broker`, body: CLAIM_DISCLAIMER, link: `/account/claims/${claim.id}`, data: { claim_id: claim.id }, channels: ["in_app", "email"] });
    const reported = { claim_id: claim.id, reference: claim.reference, policy_id: policy.id, status: "reported", incident_type: input.incidentType };
    await emitEvent(policy.broker_org_id, "claim.reported", reported);
    await emitEvent(policy.insurer_org_id, "claim.reported", reported);
    return Response.json(
      {
        ok: true,
        data: {
          claim: { ...claim, statusLabel: CLAIM_STATUS[claim.status].label, statusHint: CLAIM_STATUS[claim.status].customerHint ?? null },
          requiredEvidence: evidence,
          disclaimer: CLAIM_DISCLAIMER,
          warnings: outsideCover ? ["The incident date looks outside the cover period. Your broker will check this with you."] : [],
        },
      },
      { status: 201 },
    );
  },
  { auth: "user" },
);
