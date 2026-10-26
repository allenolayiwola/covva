import "server-only";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError } from "@/server/requests";
import { notify, notifyOrg } from "@/server/notify";
import { refundPayment } from "@/server/payments";
import { recordPolicyActive } from "@/server/usage";
import { log } from "@/server/log";
import { emitEvent, emitRequestStatus } from "@/server/webhooks";

/**
 * Policy issuance helpers. Only the insurer activates cover. `issuePolicyForInsurer`
 * writes with the service client — the policies trigger trusts the service role, so
 * this function MUST verify that `insurerOrgId` is the policy's insurer first.
 */

/**
 * Side effects once an insurer has issued a policy (status → active):
 * usage event `policy_active`, customer notification, request → completed, documents
 * delivered. Safe to call more than once. Partner UI can call this from a server
 * action after its own (RLS) issuance update.
 */
export async function onPolicyIssued(policyId: string): Promise<void> {
  // Service client: completes the request and records billing usage — system actions.
  const svc = createServiceClient();
  const { data: policy } = await svc
    .from("policies")
    .select("id, status, policy_number, internal_reference, customer_id, insurer_org_id, broker_org_id, request_id, cover_start, cover_end")
    .eq("id", policyId)
    .maybeSingle();
  if (!policy) throw new BusinessRuleError("Policy not found.", "not_found");
  if (policy.status !== "active") throw new BusinessRuleError("The policy is not active yet.");

  await recordPolicyActive(svc, policy);

  if (policy.request_id) {
    const { data: request } = await svc
      .from("requests")
      .update({ status: "completed", next_step: "Your policy documents are in your wallet." })
      .eq("id", policy.request_id)
      .in("status", ["policy_documents", "payment_confirmation"])
      .select("id, type, related_policy_id")
      .maybeSingle();
    if (request) {
      await svc.from("request_events").insert({
        request_id: request.id,
        actor_party: "insurer",
        event: "documents_delivered",
        note: `Policy ${policy.policy_number} issued by the insurer. Documents are available in the policy wallet.`,
        data: { policy_id: policy.id } as Json,
      });
      // Renewal: the previous policy is superseded once the new one is issued.
      if (request.type === "renewal" && request.related_policy_id && request.related_policy_id !== policy.id) {
        await svc.from("policies").update({ status: "renewed" }).eq("id", request.related_policy_id).in("status", ["active", "expired"]);
      }
    }
    // Issued policy documents attached to the request are now delivered to the customer's wallet.
    await svc.from("documents").update({ policy_id: policy.id }).eq("request_id", policy.request_id).in("kind", ["policy_schedule", "certificate", "policy_wording", "receipt"]).is("policy_id", null);
  }

  await notify({
    userId: policy.customer_id,
    kind: "policy.issued",
    title: `Your policy ${policy.policy_number} is active`,
    body: `The insurer has issued your policy${policy.cover_start ? ` with cover from ${policy.cover_start}` : ""}. Your documents are in your policy wallet.`,
    link: `/account/policies/${policy.id}`,
    data: { policy_id: policy.id },
  });
  if (policy.broker_org_id) {
    await notifyOrg(policy.broker_org_id, {
      kind: "policy.issued",
      title: `Policy ${policy.policy_number} issued`,
      body: `${policy.internal_reference} is now active.`,
      link: `/partner/policies/${policy.id}`,
      data: { policy_id: policy.id },
    });
  }
  const issued = { policy_id: policy.id, internal_reference: policy.internal_reference, policy_number: policy.policy_number, request_id: policy.request_id, status: "active", cover_start: policy.cover_start, cover_end: policy.cover_end };
  await emitEvent(policy.broker_org_id, "policy.issued", issued);
  await emitEvent(policy.insurer_org_id, "policy.issued", issued);
}

/**
 * Insurer declines the risk after the customer has paid (pending_issuance). Rejects the
 * application, refunds a confirmed payment through the provider, cancels the pending policy,
 * closes the request (`closed_no_cover`) and tells the customer and broker.
 *
 * Service client: the insurer may update the policy and application through RLS, but not
 * the request (broker/staff only) or the payment (provider-confirmed, server-only writes).
 * Callers MUST verify the actor belongs to `insurerOrgId` first (the partner Server Action
 * does this through `actionContext` + an RLS read of the policy).
 */
export async function declinePendingPolicy(args: { insurerOrgId: string; policyId: string; reason: string; actorId?: string | null; insurerName?: string }) {
  const svc = createServiceClient();
  const { data: policy } = await svc
    .from("policies")
    .select("id, status, customer_id, insurer_org_id, broker_org_id, request_id, quote_id, internal_reference")
    .eq("id", args.policyId)
    .maybeSingle();
  if (!policy || policy.insurer_org_id !== args.insurerOrgId) throw new BusinessRuleError("Policy not found.", "not_found");
  if (policy.status !== "pending_issuance") throw new BusinessRuleError("Only a policy awaiting issuance can be declined.");
  const reason = args.reason.trim();

  // 1. Application → rejected.
  if (policy.request_id) {
    await svc
      .from("applications")
      .update({ status: "rejected", decided_at: new Date().toISOString(), decision_note: reason })
      .eq("request_id", policy.request_id)
      .in("status", ["submitted", "draft", "accepted"]);
  }

  // 2. Refund a confirmed payment (provider-side; may complete asynchronously).
  let refund: Awaited<ReturnType<typeof refundPayment>> | null = null;
  const { data: payment } = await svc
    .from("payments")
    .select("id, status, amount, currency")
    .or(`policy_id.eq.${policy.id}${policy.request_id ? `,request_id.eq.${policy.request_id}` : ""}`)
    .eq("status", "succeeded")
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (payment) refund = await refundPayment(payment.id, `Insurer declined the risk before issuance: ${reason}`);

  // 3. Policy → cancelled (service role may cancel; never activates anything).
  const { error: pErr } = await svc
    .from("policies")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: `Risk declined by insurer before issuance: ${reason}` })
    .eq("id", policy.id)
    .eq("status", "pending_issuance");
  if (pErr) throw new BusinessRuleError(pErr.code === "P0001" ? pErr.message : "The policy could not be cancelled.");

  // 4. Request → closed without cover.
  let request: { id: string; reference: string; status: string; broker_org_id: string | null } | null = null;
  if (policy.request_id) {
    const { data: before } = await svc.from("requests").select("id, reference, status, broker_org_id").eq("id", policy.request_id).maybeSingle();
    request = before;
    if (before && !["completed", "cancelled", "closed_no_cover"].includes(before.status)) {
      await svc
        .from("requests")
        .update({ status: "closed_no_cover", next_step: refund ? "The insurer could not accept this application. Your premium is being refunded and your broker will suggest alternatives." : "The insurer could not accept this application. Your broker will suggest alternatives." })
        .eq("id", before.id);
      await svc.from("request_events").insert({
        request_id: before.id,
        actor_id: args.actorId ?? null,
        actor_party: "insurer",
        event: "insurer_declined",
        note: `${args.insurerName ?? "The insurer"} declined the risk before issuance: ${reason}`,
        data: { policy_id: policy.id, payment_id: payment?.id ?? null, refund: refund?.refund ?? null } as Json,
      });
      await emitRequestStatus(before.broker_org_id, before, before.status, "closed_no_cover");
    }
  }

  // 5. Notifications.
  const refundLine = !payment
    ? "No payment was taken."
    : refund?.refund === "processed"
      ? `Your premium of ${payment.currency} ${Number(payment.amount).toFixed(2)} has been refunded.`
      : `Your premium of ${payment.currency} ${Number(payment.amount).toFixed(2)} is being refunded to the payment method you used. This usually takes 5–10 working days.`;
  await notify({
    userId: policy.customer_id,
    kind: "payment.refund",
    title: "The insurer could not accept your application",
    body: `${refundLine} Your broker will contact you about alternatives.`,
    link: policy.request_id ? `/account/requests/${policy.request_id}` : "/account",
    data: { policy_id: policy.id, request_id: policy.request_id, payment_id: payment?.id ?? null },
    channels: ["in_app", "email", "sms", "push"],
  });
  if (policy.broker_org_id) {
    await notifyOrg(policy.broker_org_id, {
      kind: "application.declined",
      title: `${args.insurerName ?? "Insurer"} declined the risk for ${request?.reference ?? policy.internal_reference}`,
      body: `${reason}${payment ? refund?.refund === "processed" ? " The premium has been refunded." : " A refund of the premium has been requested from the payment provider." : ""} Offer the customer alternatives.`,
      link: policy.request_id ? `/partner/requests/${policy.request_id}` : "/partner/policies",
      data: { policy_id: policy.id, request_id: policy.request_id, payment_id: payment?.id ?? null },
    });
  }
  return { policyId: policy.id, requestId: policy.request_id, refunded: !!refund, refund: refund?.refund ?? null };
}

/** Insurer issues a pending policy (API key or trusted server code). */
export async function issuePolicyForInsurer(args: { insurerOrgId: string; policyId: string; policyNumber: string; coverStart: string; coverEnd: string; issuedBy?: string | null }) {
  const svc = createServiceClient();
  const { data: policy } = await svc
    .from("policies")
    .select("id, status, insurer_org_id, quote_id, request_id, external_source")
    .eq("id", args.policyId)
    .maybeSingle();
  // Authorisation: the trigger trusts the service role, so check the insurer here.
  if (!policy || policy.insurer_org_id !== args.insurerOrgId) throw new BusinessRuleError("Policy not found.", "not_found");
  if (policy.external_source) throw new BusinessRuleError("Customer-added policies can't be issued through the platform.");
  if (policy.status === "active") throw new BusinessRuleError("This policy has already been issued.", "conflict");
  if (policy.status !== "pending_issuance") throw new BusinessRuleError(`A ${policy.status.replace(/_/g, " ")} policy can't be issued.`);
  if (args.coverEnd <= args.coverStart) throw new BusinessRuleError("Cover end must be after cover start.", "invalid_input");

  // Fulfilment checkpoint: payment must be confirmed before issuance through the platform.
  const { count } = await svc.from("payments").select("id", { count: "exact", head: true }).eq("policy_id", policy.id).eq("status", "succeeded");
  if (!count) throw new BusinessRuleError("Payment for this policy has not been confirmed yet.");

  const { data: updated, error } = await svc
    .from("policies")
    .update({
      status: "active",
      policy_number: args.policyNumber,
      cover_start: args.coverStart,
      cover_end: args.coverEnd,
      issued_at: new Date().toISOString(),
      issued_by: args.issuedBy ?? null,
    })
    .eq("id", policy.id)
    .eq("status", "pending_issuance")
    .select("*")
    .maybeSingle();
  if (error?.code === "23505") throw new BusinessRuleError("That policy number is already in use for this insurer.", "conflict");
  if (error?.code === "P0001") throw new BusinessRuleError(error.message);
  if (error || !updated) {
    log.error("policy.issue_failed", { policyId: policy.id, err: error });
    throw new BusinessRuleError("The policy could not be issued.");
  }
  if (policy.request_id && policy.quote_id) {
    await svc.from("applications").update({ status: "accepted", decided_at: new Date().toISOString(), decision_note: "Accepted and issued by the insurer." }).eq("request_id", policy.request_id).eq("quote_id", policy.quote_id).eq("status", "submitted");
  }
  await onPolicyIssued(policy.id);
  return updated;
}
