import { ENDORSEMENT_KINDS, StartEndorsementInput, endorsementKindsFor } from "@im/core";
import { must, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { endorsementView, startEndorsement } from "@/server/endorsements";

/**
 * GET /api/v1/policies/{id}/endorsements — the policy's change requests (newest first) and the kinds of
 * change available for its category, with their fields. RLS: the policyholder, broker of record, insurer.
 */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/policies/[id]/endorsements">) => {
    const id = uuidParam((await route.params).id);
    const policy = must(await auth.supabase.from("policies").select("id, status, external_source, category:product_categories(slug)").eq("id", id).maybeSingle(), "Policy not found.");
    const { data } = await auth.supabase.from("endorsements").select("*").eq("policy_id", id).order("created_at", { ascending: false }).limit(50);
    const slug = (policy.category as unknown as { slug: string } | null)?.slug ?? null;
    return {
      items: (data ?? []).map(endorsementView),
      available: policy.status === "active" && !policy.external_source ? endorsementKindsFor(slug).map((k) => ({ kind: k.kind, label: ENDORSEMENT_KINDS[k.kind].label, description: k.description, fields: k.fields })) : [],
      note: "Your insurer will confirm any change in premium. Cover changes only once the insurer applies the change.",
    };
  },
  { auth: "user" },
);

/** POST /api/v1/policies/{id}/endorsements — ask for a structured change (validated per kind). */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/policies/[id]/endorsements">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, StartEndorsementInput);
    must(await auth.supabase.from("policies").select("id").eq("id", id).eq("customer_id", auth.userId).maybeSingle(), "Policy not found.");
    const r = await startEndorsement(auth.userId, id, input.kind, input.changes, input.effectiveFrom, { submit: input.submit, source: "mobile" });
    return Response.json({ ok: true, data: { endorsement: endorsementView(r.endorsement), requestId: r.requestId, proposal: r.proposal, underwriting: r.underwriting?.outcome ?? null } }, { status: 201 });
  },
  { auth: "user" },
);
