import { OPEN_REQUEST_STATUSES, RenewalInput } from "@im/core";
import { conflict, invalid, must, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { createRequest } from "@/server/requests";

/**
 * POST /api/v1/policies/{id}/renewal — start a renewal review (platform policy) or a switch
 * review (policy added from elsewhere). Existing cover is never cancelled by this.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/policies/[id]/renewal">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, RenewalInput);
    const sb = auth.supabase;
    const policy = must(
      await sb.from("policies").select("id, status, customer_id, request_id, external_source, category:product_categories(slug)").eq("id", id).maybeSingle(),
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
      { categorySlug: slug, risk, type: policy.external_source ? "switch" : "renewal", relatedPolicyId: id, source: "mobile", submit: true },
      { supabase: sb, userId: auth.userId },
    );
    if (input.changes) {
      await sb.from("request_messages").insert({ request_id: result.request.id, sender_id: auth.userId, sender_party: "customer", body: `What has changed: ${input.changes}` });
    }
    return Response.json(
      { ok: true, data: { request: result.request, note: "Renewal prices are estimates until the insurer confirms them. Your current cover stays in place." } },
      { status: 201 },
    );
  },
  { auth: "user" },
);
