"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Enum, Json, Update } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { DUE_DILIGENCE, ROLES_BY_ORG_TYPE } from "@/lib/org-meta";

const opt = (max = 300) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optDate = z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date");

const OrgFields = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  legal_name: opt(),
  registration_number: opt(100),
  nic_licence_number: opt(100),
  nic_licence_class: opt(100),
  nic_licence_expires_on: optDate,
  professional_indemnity_expires_on: optDate,
  paystack_subaccount_code: opt(100).refine((v) => v === null || /^ACCT_[A-Za-z0-9]+$/.test(v), "Paystack subaccount codes look like ACCT_xxxxxxxx"),
  integration_level: z.enum(["portal", "quote_api", "policy_api", ""]).optional().transform((v) => (v ? v : null)),
  contact_email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).optional().transform((v) => (v ? v : null)),
  contact_phone: opt(50),
  website: z.union([z.string().trim().url("Enter a full URL (https://…)"), z.literal("")]).optional().transform((v) => (v ? v : null)),
  address: opt(500),
  region: opt(100),
  description: opt(2000),
  brand_color: z.union([z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #00796E"), z.literal("")]).optional().transform((v) => (v ? v : null)),
  logo_url: z.union([z.string().trim().url(), z.literal("")]).optional().transform((v) => (v ? v : null)),
});

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";
}

const Create = OrgFields.extend({
  type: z.enum(["broker", "insurer", "enterprise"]),
  demo: z.string().optional(),
});

export async function createOrganisation(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Create.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { type, demo, ...fields } = parsed.data;
  if (type !== "insurer") fields.paystack_subaccount_code = null;

  let slug = slugify(fields.name);
  const { data: clash } = await auth.supabase.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await auth.supabase
    .from("organizations")
    .insert({ ...fields, type, slug, status: "pending", settings: { demo: demo === "on" } })
    .select("id")
    .single();
  if (error) return fail(dbMessage(error));
  redirect(`/organisations/${data.id}`);
}

const Update = OrgFields.extend({ orgId: z.string().uuid() });

export async function updateOrganisation(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Update.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { orgId, ...fields } = parsed.data;

  const { data: current } = await auth.supabase.from("organizations").select("type, nic_licence_number").eq("id", orgId).single();
  if (!current) return fail("Organisation not found.");
  if (current.type !== "insurer") fields.paystack_subaccount_code = null;
  // Changing the licence number invalidates a previous verification.
  const licenceChanged = (current.nic_licence_number ?? null) !== fields.nic_licence_number;
  const patch: Update<"organizations"> = { ...fields, ...(licenceChanged ? { licence_verified_at: null, licence_verified_by: null } : {}) };
  const { error } = await auth.supabase.from("organizations").update(patch).eq("id", orgId);
  if (error) return fail(dbMessage(error));
  return done(licenceChanged ? "Saved. The licence number changed, so it must be verified again." : "Organisation saved.");
}

const Status = z.object({
  orgId: z.string().uuid(),
  status: z.enum(["pending", "active", "suspended", "offboarded"]),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000),
});

/** Status change with a recorded reason. Activation of partners requires a verified, in-date licence. */
export async function setOrganisationStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Status.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { orgId, status, reason } = parsed.data;

  const { data: org } = await auth.supabase
    .from("organizations")
    .select("type, status, settings, licence_verified_at, nic_licence_expires_on, professional_indemnity_expires_on")
    .eq("id", orgId)
    .single();
  if (!org) return fail("Organisation not found.");
  if (org.type === "platform") return fail("The platform organisation's status cannot be changed here.");
  const today = new Date().toISOString().slice(0, 10);
  if (status === "active" && (org.type === "broker" || org.type === "insurer")) {
    if (!org.licence_verified_at) return fail("Verify the NIC licence before activating a broker or insurer.");
    if (org.nic_licence_expires_on && org.nic_licence_expires_on < today) return fail("The NIC licence has expired — update the expiry date after renewal.");
    if (org.type === "broker" && org.professional_indemnity_expires_on && org.professional_indemnity_expires_on < today) {
      return fail("Professional indemnity cover has expired — brokers cannot be activated without PI cover.");
    }
  }

  const settings = (org.settings as Record<string, Json> | null) ?? {};
  const history = Array.isArray(settings.status_history) ? settings.status_history : [];
  const nextSettings = {
    ...settings,
    status_reason: reason,
    status_history: [...history, { from: org.status, to: status, reason, by: auth.staff.userId, at: new Date().toISOString() }].slice(-20),
  };
  const { error } = await auth.supabase.from("organizations").update({ status: status as Enum<"org_status">, settings: nextSettings }).eq("id", orgId);
  if (error) return fail(dbMessage(error));
  return done(`Status changed to ${status}.`);
}

const Verify = z.object({ orgId: z.string().uuid(), value: z.enum(["true", "false"]), reason: z.string().trim().max(1000).optional() });

/** Record that the licence was checked against the NIC register (manual check). */
export async function verifyLicence(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("dueDiligence");
  if (!auth.ok) return fail(auth.error);
  const parsed = Verify.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const verify = parsed.data.value === "true";
  const { data: org } = await auth.supabase.from("organizations").select("nic_licence_number, nic_licence_expires_on").eq("id", parsed.data.orgId).single();
  if (!org) return fail("Organisation not found.");
  if (verify && !org.nic_licence_number) return fail("Record the NIC licence number first.");
  if (verify && !org.nic_licence_expires_on) return fail("Record the licence expiry date shown on the NIC register first.");
  const { error } = await auth.supabase
    .from("organizations")
    .update(verify ? { licence_verified_at: new Date().toISOString(), licence_verified_by: auth.staff.userId } : { licence_verified_at: null, licence_verified_by: null })
    .eq("id", parsed.data.orgId);
  if (error) return fail(dbMessage(error));
  return done(verify ? "Licence marked as verified against the NIC register." : "Licence verification removed.");
}

const Diligence = z.object({ orgId: z.string().uuid(), notes: z.string().trim().max(4000).optional() });

export async function saveDueDiligence(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("dueDiligence");
  if (!auth.ok) return fail(auth.error);
  const raw = formObject(fd);
  const parsed = Diligence.safeParse(raw);
  if (!parsed.success) return zodError(parsed.error);
  const { data: org } = await auth.supabase.from("organizations").select("type, settings").eq("id", parsed.data.orgId).single();
  if (!org || (org.type !== "broker" && org.type !== "insurer")) return fail("Due diligence applies to brokers and insurers.");

  const items = DUE_DILIGENCE[org.type];
  const checks: Record<string, boolean> = {};
  for (const it of items) checks[it.key] = raw[`dd_${it.key}`] === "on";
  const settings = (org.settings as Record<string, Json> | null) ?? {};
  const due_diligence = { ...checks, notes: parsed.data.notes ?? "", reviewed_at: new Date().toISOString(), reviewed_by: auth.staff.userId };
  const { error } = await auth.supabase.from("organizations").update({ settings: { ...settings, due_diligence } }).eq("id", parsed.data.orgId);
  if (error) return fail(dbMessage(error));
  const doneCount = Object.values(checks).filter(Boolean).length;
  return done(`Due diligence saved (${doneCount}/${items.length} complete).`);
}

const Demo = z.object({ orgId: z.string().uuid(), value: z.enum(["true", "false"]) });

export async function setDemoFlag(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Demo.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data: org } = await auth.supabase.from("organizations").select("settings").eq("id", parsed.data.orgId).single();
  if (!org) return fail("Organisation not found.");
  const settings = (org.settings as Record<string, Json> | null) ?? {};
  const { error } = await auth.supabase.from("organizations").update({ settings: { ...settings, demo: parsed.data.value === "true" } }).eq("id", parsed.data.orgId);
  if (error) return fail(dbMessage(error));
  return done("Demo flag updated.");
}

// Members -----------------------------------------------------------------------

const roleEnum = z.enum(["owner", "admin", "supervisor", "adviser", "underwriter", "claims_officer", "finance", "viewer", "platform_admin", "platform_ops", "compliance", "support"]);

async function checkRole(supabase: Awaited<ReturnType<typeof authorize>> & { ok: true }, orgId: string, role: Enum<"member_role">) {
  const { data: org } = await supabase.supabase.from("organizations").select("type").eq("id", orgId).single();
  if (!org) return "Organisation not found.";
  if (!ROLES_BY_ORG_TYPE[org.type].includes(role)) return `The role “${role}” is not valid for a ${org.type} organisation.`;
  if (org.type === "platform" && !supabase.staff.roles.includes("platform_admin")) return "Only a platform admin can grant platform staff roles.";
  return null;
}

const AddMember = z.object({
  orgId: z.string().uuid(),
  email: z.string().trim().email("Enter the person's email"),
  role: roleEnum,
  title: opt(100),
  team: opt(100),
  is_supervisor: z.string().optional(),
});

export async function addMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = AddMember.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { orgId, email, role, title, team, is_supervisor } = parsed.data;
  const roleErr = await checkRole(auth, orgId, role);
  if (roleErr) return fail(roleErr);

  const { data: profile } = await auth.supabase.from("profiles").select("id, full_name").ilike("email", email).maybeSingle();
  if (!profile) return fail("No user with that email exists yet. Invite them from Users → Invite user first, then add them here.");

  const { error } = await auth.supabase
    .from("memberships")
    .upsert({ org_id: orgId, user_id: profile.id, role, title, team, is_supervisor: is_supervisor === "on", active: true }, { onConflict: "org_id,user_id" });
  if (error) return fail(dbMessage(error));
  return done(`${profile.full_name ?? email} added as ${role.replace("_", " ")}.`);
}

const ChangeRole = z.object({ membershipId: z.string().uuid(), role: roleEnum });

export async function changeMemberRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = ChangeRole.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data: m } = await auth.supabase.from("memberships").select("org_id, user_id").eq("id", parsed.data.membershipId).single();
  if (!m) return fail("Membership not found.");
  const roleErr = await checkRole(auth, m.org_id, parsed.data.role);
  if (roleErr) return fail(roleErr);
  if (m.user_id === auth.staff.userId && parsed.data.role !== "platform_admin" && auth.staff.roles.includes("platform_admin")) {
    return fail("You can't remove your own platform admin role. Ask another admin.");
  }
  const { error } = await auth.supabase.from("memberships").update({ role: parsed.data.role }).eq("id", parsed.data.membershipId);
  if (error) return fail(dbMessage(error));
  return done("Role updated.");
}

const SetActive = z.object({ membershipId: z.string().uuid(), value: z.enum(["true", "false"]), reason: z.string().trim().max(1000).optional() });

export async function setMemberActive(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = SetActive.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const active = parsed.data.value === "true";
  if (!active && (!parsed.data.reason || parsed.data.reason.length < 5)) return fail("Give a reason for deactivating (at least 5 characters).");
  const { data: m } = await auth.supabase.from("memberships").select("user_id, org_id, role").eq("id", parsed.data.membershipId).single();
  if (!m) return fail("Membership not found.");
  if (!active && m.user_id === auth.staff.userId) return fail("You can't deactivate your own membership.");
  if (m.role.startsWith("platform_") || m.role === "compliance" || m.role === "support") {
    if (!auth.staff.roles.includes("platform_admin")) return fail("Only a platform admin can change platform staff memberships.");
  }
  const { error } = await auth.supabase.from("memberships").update({ active }).eq("id", parsed.data.membershipId);
  if (error) return fail(dbMessage(error));
  return done(active ? "Membership reactivated." : "Membership deactivated. The person loses access to this organisation immediately.");
}
