import { OPEN_REQUEST_STATUSES, RenewalInput, renewalOptions, type RenewalEstimate } from "@im/core";
import { conflict, invalid, must, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { createRequest } from "@/server/requests";

/**
 * POST /api/v1/policies/{id}/renewal — one-tap renewal: a renewal request for the same risk with
 * refreshed estimates, the policy's broker kept as broker of record; `renewal` holds the
 * "renew with the same insurer" offer, alternatives and savings. External policies start a switch
 * review instead. Existing cover is never cancelled by this.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/policies/[id]/renewal">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, RenewalInput);
    const sb = auth.supabase;
    const policy = must(
      await sb.from("policies").select("id, status, customer_id, request_id, external_source, broker_org_id, insurer_org_id, premium, sum_insured, category:product_categories(slug)").eq("id", id).maybeSingle(),
      "Policy not found.",
    );
    if (policy.customer_id !== auth.userId) throw rule("Only the policyholder can start a renewal.");
    if (!["active", "expired", "lapsed"].includes(policy.status)) throw rule("This policy can't be renewed yet.");

    const { data: open } = await sb.from("requests").select("id, reference, status").eq("related_policy_id", id).in("status", OPEN_REQUEST_STATUSES).limit(1).maybeSingle();
    if (open) throw conflict(`Renewal request ${open.reference} is already open.`, { requestId: open.id });

    let risk = input.risk;
    if (!risk && policy.request_id) {
      const { data: original } = await sb.from("requests").select("risk_data").eq("id", policy.request_id).maybeSingle();
      risk = (original?.risk_data as Record<string, unknown> | undefined) ?? undefined;
    }
    if (!risk) throw invalid("Tell us about the risk to renew (risk details are required).");

    const slug = (policy.category as unknown as { slug: string } | null)?.slug;
    if (!slug) throw rule("Unknown category for this policy.");
    const result = await createRequest(
      { categorySlug: slug, risk, type: policy.external_source ? "switch" : "renewal", relatedPolicyId: id, source: "mobile", submit: true, brokerOfRecordId: policy.broker_org_id },
      { supabase: sb, userId: auth.userId },
    );
    const { data: quotes } = await sb
      .from("quotes")
      .select("id, status, premium, sum_insured, insurer_org_id, product:products(name), insurer:organizations!quotes_insurer_org_id_fkey(name)")
      .eq("request_id", result.request.id);
    const estimates: RenewalEstimate[] = (quotes ?? []).map((q) => ({
      quoteId: q.id,
      insurerOrgId: q.insurer_org_id,
      insurerName: (q.insurer as unknown as { name: string } | null)?.name ?? "Insurer",
      productName: (q.product as unknown as { name: string } | null)?.name ?? null,
      premium: Number(q.premium),
      status: q.status as RenewalEstimate["status"],
      sumInsured: q.sum_insured == null ? null : Number(q.sum_insured),
    }));
    const renewal = renewalOptions(
      { insurerOrgId: policy.insurer_org_id ?? "", premium: policy.premium == null ? null : Number(policy.premium), sumInsured: policy.sum_insured == null ? null : Number(policy.sum_insured), brokerOrgId: policy.broker_org_id },
      estimates,
    );
    if (input.changes) {
      await sb.from("request_messages").insert({ request_id: result.request.id, sender_id: auth.userId, sender_party: "customer", body: `What has changed: ${input.changes}` });
    }
    return Response.json(
      { ok: true, data: { request: result.request, renewal, note: "Renewal prices are estimates until the insurer confirms them. Your current cover stays in place." } },
      { status: 201 },
    );
  },
  { auth: "user" },
);
