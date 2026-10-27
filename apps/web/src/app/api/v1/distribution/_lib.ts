import "server-only";
import { forbidden, type ApiKeyAuth } from "@/server/api-auth";

/** The calling key's distribution partner row; only active distributor organisations may use these endpoints. */
export async function requireDistributor(auth: ApiKeyAuth) {
  if (auth.orgType !== "distributor") throw forbidden("These endpoints are for distribution partners.");
  const { data: partner } = await auth.svc.from("distribution_partners").select("org_id, status, allowed_categories, segment").eq("org_id", auth.orgId).maybeSingle();
  if (!partner || partner.status !== "active") throw forbidden("Your distribution partnership is not active yet. Contact partnerships@covva.com.gh.");
  return partner;
}
