import { z } from "zod";
import { AddSchemeMemberInput } from "@im/core";
import { parseJson, parseQuery, uuidParam, withApi } from "@/server/api-auth";
import { addMember, listSchemes, requireBusinessRole, schemeDetail } from "@/server/business";

type Route = { params: Promise<{ orgId: string }> };
const Query = z.object({ schemeId: z.string().uuid().optional() });

/**
 * GET /api/v1/business/{orgId}/members[?schemeId=] — schemes with census summaries; `members` is included for
 * owners/admins only (finance and viewers get counts).
 */
export const GET = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const orgId = uuidParam((await params).orgId, "orgId");
    const ctx = { supabase: auth.supabase, userId: auth.userId, source: "mobile" as const };
    const { schemeId } = parseQuery(req, Query);
    const schemes = (await listSchemes(ctx, orgId)).filter((s) => !schemeId || s.id === schemeId);
    const details = await Promise.all(schemes.map((s) => schemeDetail(ctx, s.id)));
    return details.map((d) => ({ scheme: d.scheme, categoryName: d.categoryName, census: d.census, broker: d.broker, insurer: d.insurer, members: d.members }));
  },
  { auth: "user" },
);

/** POST /api/v1/business/{orgId}/members — add one member (owner/admin). */
export const POST = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const orgId = uuidParam((await params).orgId, "orgId");
    const ctx = { supabase: auth.supabase, userId: auth.userId, source: "mobile" as const };
    await requireBusinessRole(ctx, orgId, "members");
    const input = await parseJson(req, AddSchemeMemberInput);
    const member = await addMember(ctx, input.schemeId, input);
    return Response.json({ ok: true, data: { member } }, { status: 201 });
  },
  { auth: "user" },
);
