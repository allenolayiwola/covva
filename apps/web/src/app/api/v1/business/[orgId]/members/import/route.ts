import { ImportSchemeMembersInput } from "@im/core";
import { invalid, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { importMembers, listSchemes } from "@/server/business";

type Route = { params: Promise<{ orgId: string }> };

/** POST /api/v1/business/{orgId}/members/import — CSV census upload: `preview` (row errors) or `import`. */
export const POST = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const orgId = uuidParam((await params).orgId, "orgId");
    const ctx = { supabase: auth.supabase, userId: auth.userId, source: "mobile" as const };
    const input = await parseJson(req, ImportSchemeMembersInput);
    const schemes = await listSchemes(ctx, orgId);
    if (!schemes.some((s) => s.id === input.schemeId)) throw invalid("schemeId is not a scheme of this business");
    return importMembers(ctx, input.schemeId, input.csv, { mode: input.mode });
  },
  { auth: "user" },
);
