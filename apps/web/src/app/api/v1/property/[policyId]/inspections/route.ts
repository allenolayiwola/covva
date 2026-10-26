import { RequestInspectionInput } from "@im/core";
import { must, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { INSPECTION_STATUS, requestInspection } from "@/server/property";

const SELECT = "id, status, address, gps, scheduled_for, completed_at, report, photos, partner_org_id, created_at, updated_at";

/** GET /api/v1/property/{policyId}/inspections — inspections on a property policy with their status and report. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/property/[policyId]/inspections">) => {
    const policyId = uuidParam((await route.params).policyId, "policy");
    must(await auth.supabase.from("policies").select("id").eq("id", policyId).maybeSingle(), "Policy not found.");
    const { data } = await auth.supabase.from("property_inspections").select(SELECT).eq("policy_id", policyId).order("created_at", { ascending: false }).limit(50);
    return { items: (data ?? []).map((i) => ({ ...i, statusLabel: INSPECTION_STATUS[i.status]?.label ?? i.status })) };
  },
  { auth: "user" },
);

/** POST /api/v1/property/{policyId}/inspections — ask for a partner site inspection (customer or sponsor). */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/property/[policyId]/inspections">) => {
    const policyId = uuidParam((await route.params).policyId, "policy");
    const input = await parseJson(req, RequestInspectionInput);
    const row = await requestInspection(auth.supabase, auth.userId, { policyId, address: input.address, gps: input.gps, notes: input.notes });
    return Response.json({ ok: true, data: { ...row, statusLabel: INSPECTION_STATUS[row.status]?.label ?? row.status, message: "Inspection requested. Covva assigns a partner; the insurer decides what the report means for your cover." } }, { status: 201 });
  },
  { auth: "user" },
);
