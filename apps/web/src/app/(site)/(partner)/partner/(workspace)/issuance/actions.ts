"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { IssuePolicyInput } from "@im/core";
import { notify, notifyOrg } from "@/server/notify";
import { afterInsurerIssued, cancelDelegatedPolicy, endorseDelegatedPolicy, markMotorRegistered } from "@/server/issuance";
import { declinePendingPolicy } from "@/server/policies";
import { BusinessRuleError } from "@/server/requests";
import { emitEvent } from "@/server/webhooks";
import { ROLES, actionContext, dbMessage, run, type ActionState, type PartnerContext } from "../../_lib/context";

const uuid = z.string().uuid();

async function loadPolicy(ctx: PartnerContext, id: string) {
  const { data } = await ctx.supabase
    .from("policies")
    .select("id, status, customer_id, insurer_org_id, broker_org_id, request_id, quote_id, internal_reference, policy_number")
    .eq("id", id)
    .maybeSingle();
  return data && data.insurer_org_id === ctx.orgId ? data : null;
}

/** Only the insurer activates cover (policies_guard trigger requires insurer membership + policy number). */
export async function issuePolicy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = IssuePolicyInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ") };
    const input = parsed.data;
    if (input.coverEnd <= input.coverStart) return { ok: false, error: "Cover end must be after cover start." };
    const policy = await loadPolicy(ctx, input.policyId);
    if (!policy) return { ok: false, error: "Policy not found." };
    if (policy.status !== "pending_issuance") return { ok: false, error: "This policy is not awaiting issuance." };

    const { data: paid } = await ctx.supabase.from("payments").select("id").or(`policy_id.eq.${policy.id}${policy.request_id ? `,request_id.eq.${policy.request_id}` : ""}`).eq("status", "succeeded").limit(1);
    if (!paid?.length) return { ok: false, error: "No confirmed payment is recorded for this policy yet." };

    const { error } = await ctx.supabase
      .from("policies")
      .update({ status: "active", policy_number: input.policyNumber.trim(), cover_start: input.coverStart, cover_end: input.coverEnd })
      .eq("id", policy.id);
    if (error) return { ok: false, error: dbMessage(error, "We couldn't issue the policy.") };

    if (policy.request_id) {
      await ctx.supabase
        .from("applications")
        .update({ status: "accepted", decided_at: new Date().toISOString(), decision_note: `Issued as ${input.policyNumber.trim()}` })
        .eq("request_id", policy.request_id)
        .eq("status", "submitted");
    }
    await notify({
      userId: policy.customer_id,
      kind: "policy.issued",
      title: `Your cover is active: ${input.policyNumber.trim()}`,
      body: `Issued by ${ctx.orgName}. Cover runs ${input.coverStart} to ${input.coverEnd}. Your broker will deliver your documents.`,
      link: `/account/policies/${policy.id}`,
      data: { policy_id: policy.id },
      channels: ["in_app", "email", "sms", "push"],
    });
    if (policy.broker_org_id) {
      await notifyOrg(policy.broker_org_id, {
        kind: "policy.issued",
        title: `${ctx.orgName} issued ${input.policyNumber.trim()}`,
        body: "Deliver the policy documents to the customer to complete the request.",
        link: policy.request_id ? `/partner/requests/${policy.request_id}` : "/partner/policies",
      });
    }
    const issued = { policy_id: policy.id, internal_reference: policy.internal_reference, policy_number: input.policyNumber.trim(), request_id: policy.request_id, status: "active", cover_start: input.coverStart, cover_end: input.coverEnd };
    await emitEvent(policy.broker_org_id, "policy.issued", issued);
    await emitEvent(ctx.orgId, "policy.issued", issued);
    // Generate the schedule / certificate / receipt (and motor sticker) with the verification QR.
    const generated = await afterInsurerIssued(policy.id);
    refresh();
    return { ok: true, message: generated.length ? `Policy ${input.policyNumber.trim()} is active. ${generated.length} documents were generated with a verification QR code; you can add your own files below.` : `Policy ${input.policyNumber.trim()} is active. Upload the schedule and certificate below.` };
  });
}

/**
 * Decline the risk after payment. Membership is verified here (insurer org + underwriting
 * role, and the policy is read through RLS), then `declinePendingPolicy` performs the system
 * writes with the service client: rejecting the application, refunding the confirmed payment
 * through the provider, cancelling the pending policy and closing the request — the last two
 * are writes an insurer session can't make under RLS (requests are broker/staff only; payments
 * are server-only).
 */
export async function declineIssuance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const input = z.object({ policyId: uuid, reason: z.string().trim().min(10, "Explain the decision so the broker can tell the customer").max(2000) }).parse(Object.fromEntries(formData));
    const policy = await loadPolicy(ctx, input.policyId);
    if (!policy || policy.status !== "pending_issuance") return { ok: false, error: "Policy not awaiting issuance." };
    let result: Awaited<ReturnType<typeof declinePendingPolicy>>;
    try {
      result = await declinePendingPolicy({ insurerOrgId: ctx.orgId, policyId: policy.id, reason: input.reason, actorId: ctx.userId, insurerName: ctx.orgName });
    } catch (err) {
      if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
      if (err instanceof Error && /SUPABASE_SECRET_KEY/.test(err.message)) return { ok: false, error: "Declining after payment needs the platform's service key on this environment (it refunds the premium and closes the request). Ask platform support to complete this decline." };
      throw err;
    }
    refresh();
    return {
      ok: true,
      message: result.refunded
        ? result.refund === "processed"
          ? "Risk declined. The premium has been refunded and the broker and customer have been told."
          : "Risk declined. A refund has been requested from the payment provider; the broker and customer have been told."
        : "Risk declined. The broker and customer have been told.",
    };
  });
}

const Files = z.array(z.object({ path: z.string().min(5), name: z.string().min(1).max(200), mime: z.string().max(120), size: z.number().int().nonnegative(), kind: z.enum(["policy_schedule", "certificate", "policy_wording", "endorsement", "receipt", "other"]) })).min(1).max(10);

/** Records documents uploaded by the browser into storage for this policy. */
export async function recordPolicyDocuments(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const policyId = uuid.parse(formData.get("policyId"));
    const files = Files.parse(JSON.parse(String(formData.get("files") ?? "[]")));
    const policy = await loadPolicy(ctx, policyId);
    if (!policy) return { ok: false, error: "Policy not found." };
    if (files.some((f) => !f.path.startsWith(`${policy.customer_id}/policies/`))) return { ok: false, error: "Unexpected storage path." };
    const { error } = await ctx.supabase.from("documents").insert(
      files.map((f) => ({
        owner_id: policy.customer_id,
        uploaded_by: ctx.userId,
        uploaded_by_party: "insurer" as const,
        policy_id: policy.id,
        request_id: policy.request_id,
        kind: f.kind,
        storage_path: f.path,
        file_name: f.name,
        mime_type: f.mime,
        size_bytes: f.size,
        verified: true,
        verified_by: ctx.userId,
      })),
    );
    if (error) return { ok: false, error: dbMessage(error, "Files uploaded, but we couldn't record them. Try again.") };
    if (policy.broker_org_id) {
      await notifyOrg(policy.broker_org_id, { kind: "policy.documents", title: `Documents uploaded for ${policy.policy_number ?? policy.internal_reference}`, link: policy.request_id ? `/partner/requests/${policy.request_id}` : "/partner/policies" });
    }
    refresh();
    return { ok: true, message: `${files.length} document${files.length === 1 ? "" : "s"} uploaded.` };
  });
}

// ---------------------------------------------------------------------------
// Delegated issuance (Level 2): review window endorse / cancel, NIC registration
// ---------------------------------------------------------------------------
function serviceUnavailable(err: unknown): ActionState | null {
  if (err instanceof Error && /SUPABASE_SECRET_KEY/.test(err.message)) return { ok: false, error: "This action needs the platform's service key on this environment. Ask platform support." };
  return null;
}

/** Endorse a delegated policy: add notes and optionally regenerate the documents. Replacement files are recorded through `recordPolicyDocuments`. */
export async function endorseDelegated(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const input = z.object({ policyId: uuid, notes: z.string().trim().min(5, "Describe the endorsement").max(2000), regenerate: z.string().optional() }).parse(Object.fromEntries(formData));
    const policy = await loadPolicy(ctx, input.policyId);
    if (!policy) return { ok: false, error: "Policy not found." };
    try {
      await endorseDelegatedPolicy({ insurerOrgId: ctx.orgId, policyId: policy.id, notes: input.notes, actorId: ctx.userId, regenerate: input.regenerate === "on" });
    } catch (err) {
      return serviceUnavailable(err) ?? { ok: false, error: err instanceof Error ? err.message : "We couldn't record the endorsement." };
    }
    refresh();
    return { ok: true, message: "Endorsement recorded. The customer has been told." };
  });
}

/** Cancel a delegated policy inside the review window: cover ends, the premium is refunded. */
export async function cancelDelegated(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const input = z.object({ policyId: uuid, reason: z.string().trim().min(10, "Explain the cancellation so the customer understands").max(2000) }).parse(Object.fromEntries(formData));
    const policy = await loadPolicy(ctx, input.policyId);
    if (!policy) return { ok: false, error: "Policy not found." };
    let result: Awaited<ReturnType<typeof cancelDelegatedPolicy>>;
    try {
      result = await cancelDelegatedPolicy({ insurerOrgId: ctx.orgId, policyId: policy.id, reason: input.reason, actorId: ctx.userId, insurerName: ctx.orgName });
    } catch (err) {
      return serviceUnavailable(err) ?? { ok: false, error: err instanceof Error ? err.message : "We couldn't cancel the policy." };
    }
    refresh();
    return { ok: true, message: result.refund === "processed" ? "Policy cancelled and the premium refunded." : result.refund ? "Policy cancelled; a refund has been requested from the payment provider." : "Policy cancelled." };
  });
}

/** Records the NIC motor database reference after a manual hand-off. */
export async function recordNicRegistration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const input = z.object({ policyId: uuid, reference: z.string().trim().min(3, "Enter the NIC reference or sticker number").max(80) }).parse(Object.fromEntries(formData));
    const policy = await loadPolicy(ctx, input.policyId);
    if (!policy) return { ok: false, error: "Policy not found." };
    try {
      await markMotorRegistered({ insurerOrgId: ctx.orgId, policyId: policy.id, reference: input.reference, actorId: ctx.userId });
    } catch (err) {
      return serviceUnavailable(err) ?? { ok: false, error: err instanceof Error ? err.message : "We couldn't record the registration." };
    }
    refresh();
    return { ok: true, message: "NIC registration recorded on the policy." };
  });
}
