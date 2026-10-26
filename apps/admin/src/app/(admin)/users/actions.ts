"use server";
import { z } from "zod";
import type { Enum } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";
import { ROLES_BY_ORG_TYPE } from "@/lib/org-meta";

const roleEnum = z.enum(["owner", "admin", "supervisor", "adviser", "underwriter", "claims_officer", "finance", "viewer", "platform_admin", "platform_ops", "compliance", "support"]);

const Invite = z.object({
  email: z.string().trim().email("Enter a valid email"),
  full_name: z.string().trim().min(2, "Enter the person's name").max(200),
  orgId: z.union([z.string().uuid(), z.literal("")]).optional(),
  role: z.union([roleEnum, z.literal("")]).optional(),
});

/**
 * Invite a new user by email. Creating auth users needs the service key
 * (auth.admin API); without SUPABASE_SECRET_KEY we explain instead of failing silently.
 */
export async function inviteUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Invite.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { email, full_name, orgId, role } = parsed.data;

  let orgType: Enum<"org_type"> | null = null;
  if (orgId) {
    if (!role) return fail("Choose a role for the organisation membership.");
    const { data: org } = await auth.supabase.from("organizations").select("type").eq("id", orgId).single();
    if (!org) return fail("Organisation not found.");
    if (!ROLES_BY_ORG_TYPE[org.type].includes(role)) return fail(`“${role}” is not a valid role for a ${org.type}.`);
    if (org.type === "platform" && !auth.staff.roles.includes("platform_admin")) return fail("Only a platform admin can invite platform staff.");
    orgType = org.type;
  }

  const { data: existing } = await auth.supabase.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) return fail("A user with this email already exists — add them to an organisation from their profile instead.");

  let svc;
  try {
    svc = createServiceClient();
  } catch {
    return fail(
      "Inviting users needs SUPABASE_SECRET_KEY configured on the admin app (Supabase auth admin API). Until then, ask the person to sign up on the main site and add them to an organisation by email.",
    );
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: new URL("/auth/callback", site).toString(),
  });
  if (error || !data.user) return fail(error?.message ?? "The invitation could not be sent.");

  if (orgId && role && orgType) {
    // Membership written as the signed-in staff member so it is attributed in the audit log.
    const { error: mErr } = await auth.supabase.from("memberships").insert({ org_id: orgId, user_id: data.user.id, role });
    if (mErr) return fail(`Invitation sent, but the membership could not be created: ${dbMessage(mErr)}`);
  }
  return done(`Invitation sent to ${email}.`);
}

const AddToOrg = z.object({ userId: z.string().uuid(), orgId: z.string().uuid({ error: "Choose an organisation" }), role: roleEnum });

export async function addUserToOrg(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = AddToOrg.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { userId, orgId, role } = parsed.data;
  const { data: org } = await auth.supabase.from("organizations").select("type, name").eq("id", orgId).single();
  if (!org) return fail("Organisation not found.");
  if (!ROLES_BY_ORG_TYPE[org.type].includes(role)) return fail(`“${role}” is not a valid role for a ${org.type}.`);
  if (org.type === "platform" && !auth.staff.roles.includes("platform_admin")) return fail("Only a platform admin can grant platform staff roles.");
  const { error } = await auth.supabase.from("memberships").upsert({ org_id: orgId, user_id: userId, role, active: true }, { onConflict: "org_id,user_id" });
  if (error) return fail(dbMessage(error));
  return done(`Added to ${org.name}.`);
}
