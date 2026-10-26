import "server-only";
import { canFileProxyClaim, type ConsentRecord } from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserClient } from "@/server/api-auth";
import { BusinessRuleError } from "@/server/requests";
import { createClaim, type ClaimEvidenceFile, type CreateClaimInput, type CreateClaimResult } from "@/server/claims";
import { notifyPolicyParties } from "@/server/diaspora-notify";
import { log } from "@/server/log";

/**
 * Claims by proxy (build prompt "DIASPORA"): a sponsor abroad starts a claim on a policy they pay for,
 * on behalf of the beneficiary in Ghana — only with the beneficiary's `proxy_claims` consent.
 *
 * The claim stays the policyholder's (`claims.customer_id`); the sponsor is recorded in
 * `reported_by_user_id` with the consent row in `proxy_consent_id`. The insert goes through the
 * claims stream's `createClaim` with the service client (RLS only lets the policyholder insert).
 */
export interface ProxyClaimInput {
  incidentType: string;
  incidentAt: string | Date;
  location?: CreateClaimInput["location"];
  description: string;
  amountClaimed?: number | null;
  thirdParties?: Json;
  evidence?: ClaimEvidenceFile[];
  source?: "web" | "mobile" | "api";
}

export interface ProxyClaimResult extends CreateClaimResult {
  beneficiary: { id: string; full_name: string };
  reportedBy: string;
}

export async function fileProxyClaim(db: UserClient, sponsorUserId: string, policyId: string, input: ProxyClaimInput): Promise<ProxyClaimResult> {
  // 1. The sponsorship and consents, read as the sponsor (RLS proves they pay for this policy).
  const { data: sponsorship } = await db.from("sponsorships").select("id, status, policy_id, beneficiary_id, sponsor_user_id").eq("policy_id", policyId).eq("sponsor_user_id", sponsorUserId).maybeSingle();
  const consents: ConsentRecord[] = sponsorship ? ((await db.from("beneficiary_consents").select("id, kind, granted, granted_at, declined_at, expires_at").eq("beneficiary_id", sponsorship.beneficiary_id)).data ?? []) : [];
  const check = canFileProxyClaim(sponsorship, consents);
  if (!check.ok) throw new BusinessRuleError(check.message, check.reason === "no_sponsorship" ? "forbidden" : "business_rule");
  const proxyConsent = (consents as { id?: string; kind: string }[]).find((c) => c.kind === "proxy_claims");
  const { data: beneficiary } = await db.from("beneficiaries").select("id, full_name").eq("id", sponsorship!.beneficiary_id).maybeSingle();
  if (!beneficiary) throw new BusinessRuleError("Family member not found.", "not_found");

  // 2. The policy as the service role: the claim belongs to the policyholder.
  const svc = createServiceClient();
  const { data: policy } = await svc.from("policies").select("id, customer_id, sponsor_user_id, beneficiary_id").eq("id", policyId).maybeSingle();
  if (!policy || policy.sponsor_user_id !== sponsorUserId) throw new BusinessRuleError("You can only claim on a policy you pay for.", "forbidden");

  // Evidence paths must live under the *sponsor's* folder (they uploaded); createClaim keeps only the
  // customer's folder, so re-home them: the sponsor's uploads are linked separately below.
  const result = await createClaim(svc, {
    policyId,
    customerId: policy.customer_id,
    incidentType: input.incidentType,
    incidentAt: input.incidentAt,
    location: input.location ?? null,
    description: input.description,
    amountClaimed: input.amountClaimed ?? null,
    thirdParties: input.thirdParties,
    reportedByUserId: sponsorUserId,
    proxyConsentId: proxyConsent?.id ?? null,
    source: input.source ?? "web",
  });

  for (const f of input.evidence ?? []) {
    if (!f.path.startsWith(`${sponsorUserId}/`) || f.path.includes("..")) continue;
    const { error } = await svc.from("documents").insert({
      owner_id: policy.customer_id,
      uploaded_by: sponsorUserId,
      uploaded_by_party: "customer",
      claim_id: result.claim.id,
      policy_id: policyId,
      kind: f.kind ?? (f.mime?.startsWith("image/") ? "photo" : "claim_evidence"),
      storage_path: f.path,
      file_name: f.name.slice(0, 255),
      mime_type: f.mime || null,
      size_bytes: f.size || null,
    });
    if (error) log.warn("proxy_claim.evidence_link_failed", { claimId: result.claim.id, err: error });
  }

  // 3. Make sure the sponsor is stamped on the claim even on databases where createClaim dropped the column.
  await svc.from("claims").update({ reported_by_user_id: sponsorUserId, proxy_consent_id: proxyConsent?.id ?? null }).eq("id", result.claim.id).is("reported_by_user_id", null);

  // 4. Both parties: the policyholder was told by createClaim; the sponsor and an account-less beneficiary here.
  await svc.from("claim_events").insert({
    claim_id: result.claim.id,
    actor_id: sponsorUserId,
    actor_party: "customer",
    note: `Reported by the policy sponsor on behalf of ${beneficiary.full_name} (with the beneficiary's consent).`,
    visible_to_customer: true,
  });
  await notifyPolicyParties(policyId, "claim.reported", {
    title: `Claim ${result.claim.reference} reported for ${beneficiary.full_name}`,
    body: `You reported ${input.incidentType.replace(/_/g, " ")} on behalf of ${beneficiary.full_name}. The broker checks the evidence and delivers it to the insurer; only the insurer decides the claim.`,
    link: `/account/claims/${result.claim.id}`,
    data: { claim_id: result.claim.id, proxy: true },
    skipUserIds: [policy.customer_id],
    beneficiarySms: `Covva: a claim (${result.claim.reference}) was reported on your policy by your sponsor. Your broker will contact you. Only the insurer decides the claim.`,
  }).catch((err) => log.warn("proxy_claim.notify_failed", { claimId: result.claim.id, err }));

  return { ...result, beneficiary, reportedBy: sponsorUserId };
}
