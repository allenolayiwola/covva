"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { IssuePolicyInput } from "@im/core";
import { notify, notifyOrg } from "@/server/notify";
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
    refresh();
    return { ok: true, message: `Policy ${input.policyNumber.trim()} is active. Upload the schedule and certificate below.` };
  });
}

export async function declineIssuance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const input = z.object({ policyId: uuid, reason: z.string().trim().min(10, "Explain the decision so the broker can tell the customer").max(2000) }).parse(Object.fromEntries(formData));
    const policy = await loadPolicy(ctx, input.policyId);
    if (!policy || policy.status !== "pending_issuance") return { ok: false, error: "Policy not awaiting issuance." };
    if (policy.request_id) {
      const { error: aErr } = await ctx.supabase
        .from("applications")
        .update({ status: "rejected", decided_at: new Date().toISOString(), decision_note: input.reason })
        .eq("request_id", policy.request_id)
        .in("status", ["submitted", "draft"]);
      if (aErr) return { ok: false, error: dbMessage(aErr) };
    }
    const { error } = await ctx.supabase
      .from("policies")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: `Risk declined by insurer before issuance: ${input.reason}` })
      .eq("id", policy.id);
    if (error) return { ok: false, error: dbMessage(error) };
    await notify({
      userId: policy.customer_id,
      kind: "application.declined",
      title: "The insurer could not accept your application",
      body: "Your broker will contact you about alternatives and any refund of your premium.",
      link: policy.request_id ? `/account/requests/${policy.request_id}` : "/account",
    });
    if (policy.broker_org_id) {
      await notifyOrg(policy.broker_org_id, { kind: "application.declined", title: `${ctx.orgName} declined the risk for ${policy.internal_reference}`, body: input.reason, link: policy.request_id ? `/partner/requests/${policy.request_id}` : "/partner/policies" });
    }
    refresh();
    return { ok: true, message: "Risk declined. The broker and customer have been told; refunds are handled by the payment provider." };
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
