import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Enum } from "@im/db";
import { createClient } from "@/lib/supabase/server";
import { STAFF_ROLES, type StaffRole } from "@/lib/roles";

export { STAFF_ROLES, type StaffRole } from "@/lib/roles";

/** MFA is required unless explicitly disabled for local demos (`ADMIN_MFA_REQUIRED=false`). */
export function mfaRequired(): boolean {
  return (process.env.ADMIN_MFA_REQUIRED ?? "true").trim().toLowerCase() !== "false";
}

export interface Staff {
  userId: string;
  email: string | null;
  name: string | null;
  orgId: string;
  roles: StaffRole[];
  /** Highest-privilege role, for display. */
  role: StaffRole;
  aal: string | null;
  mfaRequired: boolean;
}

type Resolution =
  | { status: "anonymous" }
  | { status: "mfa" }
  | { status: "forbidden"; email: string | null }
  | { status: "ok"; staff: Staff };

const isStaffRole = (r: Enum<"member_role">): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r);

/**
 * Resolves the current platform staff member. Deduped per request with React cache.
 * Staff = active membership of an organisation of type `platform` with a staff role.
 */
export const resolveStaff = cache(async (): Promise<Resolution> => {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { status: "anonymous" };

  const required = mfaRequired();
  let aal: string | null = null;
  {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    aal = data?.currentLevel ?? null;
  }
  if (required && aal !== "aal2") return { status: "mfa" };

  const { data: rows } = await supabase
    .from("memberships")
    .select("role, org_id, organizations!inner(type, status)")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("organizations.type", "platform");

  const roles = (rows ?? []).map((r) => r.role).filter(isStaffRole);
  if (!roles.length) return { status: "forbidden", email: user.email ?? null };

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const ordered = STAFF_ROLES.filter((r) => roles.includes(r));
  return {
    status: "ok",
    staff: {
      userId: user.id,
      email: user.email ?? null,
      name: profile?.full_name ?? null,
      orgId: rows![0]!.org_id,
      roles: ordered,
      role: ordered[0]!,
      aal,
      mfaRequired: required,
    },
  };
});

/**
 * Page guard. Redirects anonymous users to sign-in, un-verified sessions to MFA and
 * non-staff (or staff without one of `roles`) to the 403 page.
 */
export async function requireStaff(roles?: readonly StaffRole[]): Promise<Staff> {
  const r = await resolveStaff();
  if (r.status === "anonymous") redirect("/sign-in");
  if (r.status === "mfa") redirect("/mfa");
  if (r.status === "forbidden") redirect("/no-access");
  if (roles && !hasAnyRole(r.staff, roles)) redirect(`/no-access?need=${encodeURIComponent(roles.join(","))}`);
  return r.staff;
}

export function hasAnyRole(staff: Pick<Staff, "roles">, roles: readonly StaffRole[]): boolean {
  return staff.roles.some((r) => roles.includes(r));
}
