import { AddExternalPolicyInput } from "@im/core";
import { getCategory } from "@/lib/catalog";
import { createServiceClient } from "@/lib/supabase/server";
import { invalid, must, notFound, parseJson, withApi } from "@/server/api-auth";

/** POST /api/v1/policies/external — add a policy bought elsewhere to the wallet (shown as "Added by you"). */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, AddExternalPolicyInput);
    if (input.coverEnd <= input.coverStart) throw invalid("Cover end must be after cover start.");
    const category = await getCategory(input.categorySlug);
    if (!category) throw notFound("Unknown insurance category.");
    const { data: insurer } = await auth.supabase.from("organizations").select("id, type").eq("id", input.insurerOrgId).maybeSingle();
    if (!insurer || insurer.type !== "insurer") throw notFound("Unknown insurer.");
    const today = new Date().toISOString().slice(0, 10);
    const policy = must(
      await auth.supabase
        .from("policies")
        .insert({
          customer_id: auth.userId,
          insurer_org_id: insurer.id,
          category_id: category.id,
          external_source: true,
          status: input.coverEnd < today ? "expired" : "active",
          policy_number: input.policyNumber,
          cover_start: input.coverStart,
          cover_end: input.coverEnd,
          premium: input.premium ?? null,
          sum_insured: input.sumInsured ?? null,
          nickname: input.nickname ?? null,
          summary: "Added by you — details not confirmed by the insurer.",
        })
        .select("id, internal_reference, policy_number, status, cover_start, cover_end, external_source, nickname")
        .single(),
    );
    if (input.documentId) {
      const { data: doc } = await auth.supabase.from("documents").select("id, owner_id").eq("id", input.documentId).maybeSingle();
      // Service client: customers can't update document rows (staff-only RLS); ownership verified here.
      if (doc && doc.owner_id === auth.userId) await createServiceClient().from("documents").update({ policy_id: policy.id }).eq("id", doc.id);
    }
    return Response.json({ ok: true, data: { policy, note: "Added to your wallet. We haven't checked these details with the insurer." } }, { status: 201 });
  },
  { auth: "user" },
);
