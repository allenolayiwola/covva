import { PropertyUpdateInput } from "@im/core";
import { must, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { addPropertyUpdate } from "@/server/property";

/** GET /api/v1/property/{policyId}/updates — construction / site photo updates on a property policy (RLS: parties only). */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/property/[policyId]/updates">) => {
    const policyId = uuidParam((await route.params).policyId, "policy");
    must(await auth.supabase.from("policies").select("id").eq("id", policyId).maybeSingle(), "Policy not found.");
    const { data } = await auth.supabase.from("property_updates").select("id, storage_path, caption, taken_at, uploaded_by, created_at").eq("policy_id", policyId).order("created_at", { ascending: false }).limit(200);
    return { items: data ?? [] };
  },
  { auth: "user" },
);

/**
 * POST /api/v1/property/{policyId}/updates — record a photo already uploaded with
 * `POST /documents/upload-url` (scope `policies`, the caller's own folder). Customer or sponsor only.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/property/[policyId]/updates">) => {
    const policyId = uuidParam((await route.params).policyId, "policy");
    const input = await parseJson(req, PropertyUpdateInput);
    const row = await addPropertyUpdate(auth.supabase, auth.userId, { policyId, storagePath: input.storagePath, caption: input.caption, takenAt: input.takenAt });
    return Response.json({ ok: true, data: row }, { status: 201 });
  },
  { auth: "user" },
);
