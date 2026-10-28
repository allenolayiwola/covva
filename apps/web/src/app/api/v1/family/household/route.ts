import { withApi } from "@/server/api-auth";
import { householdCover } from "@/server/household";

/**
 * GET /api/v1/family/household — the household view for the signed-in person (a sponsor abroad or a customer
 * in Ghana): every policy they may see, grouped by who it covers, with who pays, what renews next and who
 * has no cover.
 */
export const GET = withApi(async ({ auth }) => {
  const { data: profile } = await auth.supabase.from("profiles").select("full_name, preferred_name").eq("id", auth.userId).maybeSingle();
  return householdCover(auth.supabase, auth.userId, profile?.preferred_name || profile?.full_name || null);
}, { auth: "user" });
