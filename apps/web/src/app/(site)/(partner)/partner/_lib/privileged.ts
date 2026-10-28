import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Narrow, privileged reads the RLS policies deliberately don't expose to partner users.
 *
 * WHY the service client is used here (and only here in the partner workspace):
 *  - `profiles` RLS only shows a user their own profile and the customers routed to their
 *    org, so colleagues' names are invisible. We read just `full_name`/`email` for user ids
 *    that the caller has already proven (via RLS on `memberships`) are in their organisation.
 *  - `consents` RLS is owner/platform-only, but a broker must confirm data-sharing consent
 *    before working a request. We read only consent type/granted/date for a customer whose
 *    request the caller can already read via RLS.
 *  - Assisted requests need an exact email/phone lookup of an existing customer account.
 *    We return only id + display name for an exact match.
 *
 * Every function degrades gracefully when SUPABASE_SECRET_KEY is not configured.
 * Follow-up for Foundation/Backend: replace with SECURITY DEFINER RPCs scoped by org.
 */
function svc() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

export interface Person {
  id: string;
  name: string | null;
  email: string | null;
}

/** Names of org members. Caller MUST pass ids obtained from an RLS-scoped memberships read. */
export async function colleagueNames(userIds: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  if (!userIds.length) return out;
  const client = svc();
  if (!client) return out;
  const { data } = await client.from("profiles").select("id, full_name, email").in("id", userIds);
  for (const p of data ?? []) out.set(p.id, { id: p.id, name: p.full_name, email: p.email });
  return out;
}

export type ConsentSummary = { type: string; granted: boolean; at: string }[] | null;

/** Latest consent decision per type. Caller MUST have verified access to a request of this customer via RLS. */
export async function customerConsents(customerId: string): Promise<ConsentSummary> {
  const client = svc();
  if (!client) return null;
  const { data } = await client
    .from("consents")
    .select("type, granted, created_at")
    .eq("user_id", customerId)
    .order("created_at", { ascending: false });
  const seen = new Map<string, { type: string; granted: boolean; at: string }>();
  for (const c of data ?? []) if (!seen.has(c.type)) seen.set(c.type, { type: c.type, granted: c.granted, at: c.created_at });
  return [...seen.values()];
}

/** Exact match on email or phone. Returns null if not found; throws if lookup is unavailable. */
export async function findCustomer(identifier: string): Promise<{ id: string; name: string | null } | null | "unavailable"> {
  const client = svc();
  if (!client) return "unavailable";
  const value = identifier.trim();
  const isEmail = value.includes("@");
  const query = client.from("profiles").select("id, full_name").limit(1);
  const { data } = isEmail
    ? await query.eq("email", value.toLowerCase())
    : await query.eq("phone", value.replace(/\s+/g, ""));
  const p = data?.[0];
  return p ? { id: p.id, name: p.full_name } : null;
}
