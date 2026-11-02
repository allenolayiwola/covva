import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Enum, Row } from "@im/db";
import { createClient } from "@/lib/supabase/server";
import { mfaRequiredFor } from "@/lib/partner-mfa";

export type Membership = Pick<Row<"memberships">, "id" | "org_id" | "role" | "team" | "title" | "is_supervisor"> & {
  org: Pick<Row<"organizations">, "id" | "name" | "slug" | "type" | "status" | "nic_licence_number" | "logo_url" | "settings" | "require_mfa">;
};

/**
 * MFA (TOTP, Supabase Auth AAL2) for broker and insurer users in the partner workspace (Addendum 4):
 * `partnerMfaRequired()` is the platform switch, `mfaRequiredFor()` adds the per-organisation `require_mfa`.
 * Customers are never gated.
 */
export { mfaRequiredFor, partnerMfaRequired } from "@/lib/partner-mfa";

type PartnerKind = Extract<Enum<"org_type">, "broker" | "insurer" | "distributor">;

/** The memberships that open the partner workspace (one org type when `kind` is given). */
export function partnerMemberships(memberships: Membership[], kind?: PartnerKind): Membership[] {
  return memberships.filter((m) => (kind ? m.org.type === kind : m.org.type === "broker" || m.org.type === "insurer" || m.org.type === "distributor"));
}

/** Current auth user (verified with Supabase Auth), deduped per request. */
export const getUser = cache(async () => {
  // Session handling reads the clock (token expiry); mark this as request-time work so
  // prerendering doesn't trip "unstable value Date.now()" under Cache Components.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/** Current authenticator assurance level ("aal1" | "aal2" | null), deduped per request. */
export const getAssuranceLevel = cache(async (): Promise<string | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel ?? null;
});

export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data;
});

export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("id, org_id, role, team, title, is_supervisor, org:organizations(id, name, slug, type, status, nic_licence_number, logo_url, settings, require_mfa)")
    .eq("user_id", user.id)
    .eq("active", true);
  return (data ?? []) as unknown as Membership[];
});

/** Redirects to sign-in when there is no session. */
export async function requireUser(next?: string) {
  const user = await getUser();
  if (!user) redirect(`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}

/**
 * Partner workspace guard. Returns the active partner membership (broker, insurer or distributor —
 * distributors get a reduced workspace: dashboard, widget, links, API keys, statements).
 * `kind` restricts to one org type. Platform staff may view the workspace for support.
 *
 * MFA gate: when `partnerMfaRequired()` and at least one of the user's partner organisations has
 * `require_mfa` on, the session must be AAL2 — otherwise the user is sent to `/partner/mfa` to
 * enrol or verify a TOTP factor and comes back to `next`.
 */
export async function requirePartner(kind?: PartnerKind, next = "/partner") {
  await requireUser(next);
  const partner = partnerMemberships(await getMemberships(), kind);
  if (!partner.length) redirect("/partner/no-access");
  if (mfaRequiredFor(partner)) {
    const aal = await getAssuranceLevel();
    if (aal !== "aal2") redirect(`/partner/mfa?next=${encodeURIComponent(next)}`);
  }
  return { membership: partner[0]!, all: partner };
}

export function hasRole(m: Membership, roles: Enum<"member_role">[]) {
  return roles.includes(m.role);
}

export const isPlatformStaff = cache(async () => (await getMemberships()).some((m) => m.org.type === "platform"));
