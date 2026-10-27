import { CreateBusinessInput } from "@im/core";
import { parseJson, withApi } from "@/server/api-auth";
import { createBusinessAccount, linkSchemeMemberships, myBusinessAccounts, myWorkplaceCover } from "@/server/business";

/** GET /api/v1/business — the caller's business accounts (with role) and their own workplace cover as a scheme member. */
export const GET = withApi(
  async ({ auth }) => {
    const ctx = { supabase: auth.supabase, userId: auth.userId, source: "mobile" as const };
    await linkSchemeMemberships(auth.supabase);
    const [accounts, workplaceCover] = await Promise.all([myBusinessAccounts(ctx), myWorkplaceCover(ctx)]);
    return { accounts, workplaceCover };
  },
  { auth: "user" },
);

/** POST /api/v1/business — create a business account; the caller becomes its owner. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, CreateBusinessInput);
    const { orgId } = await createBusinessAccount(auth.userId, input, { supabase: auth.supabase });
    return Response.json({ ok: true, data: { orgId } }, { status: 201 });
  },
  { auth: "user" },
);
