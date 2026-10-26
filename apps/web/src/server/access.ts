import "server-only";
import type { Enum } from "@im/db";
import { forbidden, notFound, type UserAuth } from "@/server/api-auth";

export type RequestParty = Extract<Enum<"party">, "customer" | "broker" | "insurer" | "platform">;

/**
 * Load a request through RLS and work out how the caller relates to it.
 * RLS already hides requests the caller can't see; this adds the party for writes.
 */
export async function requestForCaller(auth: UserAuth, requestId: string) {
  const { data: request } = await auth.supabase
    .from("requests")
    .select("id, reference, status, type, title, customer_id, broker_org_id, category_id, risk_data, related_policy_id, next_step")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) throw notFound("Request not found.");
  if (request.customer_id === auth.userId) return { request, party: "customer" as RequestParty };
  const { data: memberships } = await auth.supabase
    .from("memberships")
    .select("org_id, org:organizations!memberships_org_id_fkey(type)")
    .eq("user_id", auth.userId)
    .eq("active", true);
  const ms = memberships ?? [];
  if (request.broker_org_id && ms.some((m) => m.org_id === request.broker_org_id)) return { request, party: "broker" as RequestParty };
  if (ms.some((m) => (m.org as unknown as { type: string } | null)?.type === "platform")) return { request, party: "platform" as RequestParty };
  return { request, party: "insurer" as RequestParty };
}

/** As `requestForCaller`, but only the request's customer may proceed. */
export async function requestForCustomer(auth: UserAuth, requestId: string) {
  const r = await requestForCaller(auth, requestId);
  if (r.party !== "customer") throw forbidden("Only the customer can do this.");
  return r.request;
}
