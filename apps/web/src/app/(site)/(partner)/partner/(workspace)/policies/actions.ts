"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { OPEN_REQUEST_STATUSES } from "@im/core";
import type { Json } from "@im/db";
import { notify } from "@/server/notify";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

/** Start a renewal request on behalf of the customer (RLS insert as broker member). */
export async function startRenewal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
    const policyId = z.string().uuid().parse(formData.get("policyId"));
    const { data: policy } = await ctx.supabase
      .from("policies")
      .select("id, customer_id, category_id, broker_org_id, request_id, policy_number, internal_reference, cover_end, insured_items")
      .eq("id", policyId)
      .maybeSingle();
    if (!policy || policy.broker_org_id !== ctx.orgId) return { ok: false, error: "Policy not found in your book." };

    const { data: existing } = await ctx.supabase
      .from("requests")
      .select("id, reference")
      .eq("related_policy_id", policy.id)
      .eq("type", "renewal")
      .in("status", OPEN_REQUEST_STATUSES)
      .limit(1);
    if (existing?.length) return { ok: false, error: `A renewal is already in progress (${existing[0]!.reference}).` };

    let risk: Record<string, unknown> = (policy.insured_items ?? {}) as Record<string, unknown>;
    let fingerprint: string | null = null;
    if (policy.request_id) {
      const { data: orig } = await ctx.supabase.from("requests").select("risk_data").eq("id", policy.request_id).maybeSingle();
      if (orig?.risk_data) risk = orig.risk_data as Record<string, unknown>;
    }
    // A renewal is a new risk period: fingerprint includes the policy and period so it can be re-submitted.
    fingerprint = `renewal:${policy.id}:${policy.cover_end ?? "open"}`;

    const due = policy.cover_end ? new Date(Math.min(Date.parse(policy.cover_end), Date.now() + 7 * 86_400_000)).toISOString() : null;
    const ref = policy.policy_number ?? policy.internal_reference;
    const { data: req, error } = await ctx.supabase
      .from("requests")
      .insert({
        customer_id: policy.customer_id,
        category_id: policy.category_id,
        type: "renewal",
        status: "submitted",
        source: "call_centre",
        title: `Renewal of ${ref}`,
        broker_org_id: ctx.orgId,
        assigned_to: ctx.userId,
        team: ctx.membership.team,
        risk_data: risk as Json,
        risk_fingerprint: fingerprint,
        related_policy_id: policy.id,
        due_at: due,
        next_step: "Confirm what has changed since last year. Renewal prices are estimates until the insurer confirms.",
      })
      .select("id, reference")
      .single();
    if (error) return { ok: false, error: dbMessage(error, "We couldn't start the renewal.") };

    await ctx.supabase.from("request_tasks").insert({
      request_id: req.id,
      kind: "information",
      title: "Confirm what has changed since your last renewal",
      detail: "For example a new driver, a change of address, modifications or claims. If nothing has changed, just say so.",
      assignee_party: "customer",
      created_by: ctx.userId,
      due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    await notify({
      userId: policy.customer_id,
      kind: "renewal.started",
      title: `Your renewal for ${ref} has started`,
      body: `${ctx.orgName} is preparing your renewal. Tell us what has changed. Renewal prices are estimates until the insurer confirms.`,
      link: `/account/requests/${req.id}`,
      data: { request_id: req.id, policy_id: policy.id },
      channels: ["in_app", "email", "sms", "push"],
    });
    refresh();
    return { ok: true, message: `Renewal ${req.reference} started.`, data: { requestId: req.id } };
  });
}
