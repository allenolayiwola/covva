import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Enum, Row } from "@im/db";
import { createClient } from "@/lib/supabase/server";

export type Membership = Pick<Row<"memberships">, "id" | "org_id" | "role" | "team" | "title" | "is_supervisor"> & {
  org: Pick<Row<"organizations">, "id" | "name" | "slug" | "type" | "status" | "nic_licence_number" | "logo_url" | "settings">;
};

/** Current auth user (verified with Supabase Auth), deduped per request. */
export const getUser = cache(async () => {
  // Session handling reads the clock (token expiry); mark this as request-time work so
  // prerendering doesn't trip "unstable value Date.now()" under Cache Components.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
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
    .select("id, org_id, role, team, title, is_supervisor, org:organizations(id, name, slug, type, status, nic_licence_number, logo_url, settings)")
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
 * Partner workspace guard. Returns the active partner membership (broker or insurer).
 * `kind` restricts to one org type. Platform staff may view the workspace for support.
 */
export async function requirePartner(kind?: Extract<Enum<"org_type">, "broker" | "insurer">, next = "/partner") {
  await requireUser(next);
  const memberships = await getMemberships();
  const partner = memberships.filter((m) => (kind ? m.org.type === kind : m.org.type === "broker" || m.org.type === "insurer"));
  if (!partner.length) redirect("/partner/no-access");
  return { membership: partner[0]!, all: partner };
}

export function hasRole(m: Membership, roles: Enum<"member_role">[]) {
  return roles.includes(m.role);
}

export const isPlatformStaff = cache(async () => (await getMemberships()).some((m) => m.org.type === "platform"));
