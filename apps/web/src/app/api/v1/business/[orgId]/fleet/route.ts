import { AddFleetInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { addVehicle, importFleet, listFleet } from "@/server/business";

type Route = { params: Promise<{ orgId: string }> };

/** GET /api/v1/business/{orgId}/fleet — active vehicles. */
export const GET = withApi<"user", Route>(
  async ({ auth }, { params }) => {
    const orgId = uuidParam((await params).orgId, "orgId");
    return listFleet({ supabase: auth.supabase, userId: auth.userId, source: "mobile" }, orgId);
  },
  { auth: "user" },
);

/** POST /api/v1/business/{orgId}/fleet — add one vehicle, or `{ csv, mode }` for a bulk upload (owner/admin). */
export const POST = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const orgId = uuidParam((await params).orgId, "orgId");
    const ctx = { supabase: auth.supabase, userId: auth.userId, source: "mobile" as const };
    const input = await parseJson(req, AddFleetInput);
    if ("csv" in input) return importFleet(ctx, orgId, input.csv, { mode: input.mode });
    const vehicle = await addVehicle(ctx, orgId, input);
    return Response.json({ ok: true, data: { vehicle } }, { status: 201 });
  },
  { auth: "user" },
);
