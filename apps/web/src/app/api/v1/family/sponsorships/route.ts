import { CreateSponsorshipInput } from "@im/core";
import { check, parseJson, withApi } from "@/server/api-auth";
import { createSponsorship } from "@/server/diaspora";

/** GET /api/v1/family/sponsorships — the caller's sponsorships (payer ↔ policy ↔ beneficiary). */
export const GET = withApi(
  async ({ auth }) => {
    const res = await auth.supabase.from("sponsorships").select("*").eq("sponsor_user_id", auth.userId).order("created_at", { ascending: false });
    check(res);
    return res.data ?? [];
  },
  { auth: "user" },
);

/** POST /api/v1/family/sponsorships — link the payer to a beneficiary and a request/policy; gift fields optional. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, CreateSponsorshipInput);
    const sponsorship = await createSponsorship(auth.supabase, auth.userId, input);
    return Response.json({ ok: true, data: { sponsorship } }, { status: 201 });
  },
  { auth: "user" },
);
