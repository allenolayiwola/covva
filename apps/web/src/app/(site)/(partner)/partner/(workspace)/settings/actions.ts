"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import type { Enum, Json } from "@im/db";
import { sendInviteEmail } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";
import { API_SCOPES, BROKER_ROLES, DISTRIBUTOR_API_SCOPES, DISTRIBUTOR_ROLES, INSURER_ROLES, WEBHOOK_EVENTS } from "../../_lib/settings";
import { generateApiKey } from "@/server/api-auth";

const uuid = z.string().uuid();

function allowedRoles(kind: "broker" | "insurer" | "distributor"): readonly string[] {
  return kind === "broker" ? BROKER_ROLES : kind === "distributor" ? DISTRIBUTOR_ROLES : INSURER_ROLES;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
export async function inviteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const input = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), role: z.string(), team: z.string().trim().max(60).optional() }).parse(Object.fromEntries(formData));
    if (!allowedRoles(ctx.kind).includes(input.role)) return { ok: false, error: "Choose a valid role." };
    const { data: pendingInvite } = await ctx.supabase.from("invitations").select("id").eq("org_id", ctx.orgId).eq("email", input.email).is("accepted_at", null).gt("expires_at", new Date().toISOString()).limit(1);
    if (pendingInvite?.length) return { ok: false, error: "There is already a pending invitation for this email." };
    const { data, error } = await ctx.supabase
      .from("invitations")
      .insert({ org_id: ctx.orgId, email: input.email, role: input.role as Enum<"member_role">, team: input.team || null, invited_by: ctx.userId })
      .select("token, expires_at")
      .single();
    if (error) return { ok: false, error: dbMessage(error, "We couldn't create the invitation.") };
    const { data: me } = await ctx.supabase.from("profiles").select("full_name, preferred_name").eq("id", ctx.userId).maybeSingle();
    await sendInviteEmail({ to: input.email, orgName: ctx.orgName, role: input.role, token: data.token, invitedBy: me?.preferred_name || me?.full_name || ctx.userEmail, expiresAt: data.expires_at }).catch(() => {});
    refresh();
    return { ok: true, message: `Invitation emailed to ${input.email}. It expires in 14 days — you can also share the link below.`, data: { link: `/invite/${data.token}` } };
  });
}

export async function revokeInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const id = uuid.parse(formData.get("id"));
    const { error } = await ctx.supabase.from("invitations").delete().eq("id", id).eq("org_id", ctx.orgId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true };
  });
}

export async function updateMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const input = z.object({ membershipId: uuid, role: z.string(), team: z.string().trim().max(60).optional(), title: z.string().trim().max(80).optional(), supervisor: z.string().optional() }).parse(Object.fromEntries(formData));
    const { data: m } = await ctx.supabase.from("memberships").select("id, user_id, role, org_id").eq("id", input.membershipId).maybeSingle();
    if (!m || m.org_id !== ctx.orgId) return { ok: false, error: "Member not found." };
    if (m.user_id === ctx.userId && input.role !== m.role) return { ok: false, error: "You can't change your own role. Ask another admin." };
    if (m.role === "owner" && input.role !== "owner") return { ok: false, error: "Owners are changed by platform support." };
    if (input.role !== m.role && !allowedRoles(ctx.kind).includes(input.role)) return { ok: false, error: "Choose a valid role." };
    const { error } = await ctx.supabase
      .from("memberships")
      .update({ role: input.role as Enum<"member_role">, team: input.team || null, title: input.title || null, is_supervisor: input.supervisor === "on" || input.role === "supervisor" })
      .eq("id", m.id);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Member updated." };
  });
}

export async function setMemberActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const input = z.object({ membershipId: uuid, active: z.enum(["true", "false"]) }).parse(Object.fromEntries(formData));
    const { data: m } = await ctx.supabase.from("memberships").select("id, user_id, role, org_id").eq("id", input.membershipId).maybeSingle();
    if (!m || m.org_id !== ctx.orgId) return { ok: false, error: "Member not found." };
    if (m.user_id === ctx.userId) return { ok: false, error: "You can't deactivate yourself." };
    if (m.role === "owner") return { ok: false, error: "Owners can only be removed by platform support." };
    const active = input.active === "true";
    const { error } = await ctx.supabase.from("memberships").update({ active }).eq("id", m.id);
    if (error) return { ok: false, error: dbMessage(error) };
    if (!active) {
      // Hand their open work back to the team queue.
      await ctx.supabase.from("requests").update({ assigned_to: null }).eq("broker_org_id", ctx.orgId).eq("assigned_to", m.user_id).not("status", "in", "(completed,cancelled,closed_no_cover)");
    }
    refresh();
    return { ok: true, message: active ? "Member reactivated." : "Member deactivated. Their open requests are unassigned." };
  });
}

// ---------------------------------------------------------------------------
// Organisation profile
// ---------------------------------------------------------------------------
export async function updateOrg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const input = z
      .object({
        contact_email: z.string().trim().email("Enter a valid contact email").or(z.literal("")),
        contact_phone: z.string().trim().max(40),
        address: z.string().trim().max(300),
        region: z.string().trim().max(60),
        website: z.string().trim().url("Website must be a full URL (https://…)").or(z.literal("")),
        description: z.string().trim().max(1000),
        service_hours: z.string().trim().max(120),
      })
      .parse(Object.fromEntries(formData));
    const { data: org } = await ctx.supabase.from("organizations").select("settings").eq("id", ctx.orgId).single();
    const settings = { ...((org?.settings ?? {}) as Record<string, unknown>), service_hours: input.service_hours || undefined };
    const { error } = await ctx.supabase
      .from("organizations")
      .update({
        contact_email: input.contact_email || null,
        contact_phone: input.contact_phone || null,
        address: input.address || null,
        region: input.region || null,
        website: input.website || null,
        description: input.description || null,
        settings: settings as Json,
      })
      .eq("id", ctx.orgId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Organisation profile saved." };
  });
}

export async function setLogo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const url = z.string().url().parse(formData.get("url"));
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-assets/${ctx.orgId}/`;
    if (!url.startsWith(base)) return { ok: false, error: "Unexpected logo location." };
    const { error } = await ctx.supabase.from("organizations").update({ logo_url: url }).eq("id", ctx.orgId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Logo updated." };
  });
}

// ---------------------------------------------------------------------------
// Developer: API keys and webhooks
// ---------------------------------------------------------------------------

/** Creates an API key. Only a prefix and SHA-256 hash are stored; the secret is shown once. */
export async function createApiKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const name = z.string().trim().min(2, "Name the key (e.g. “Core system”)").max(80).parse(formData.get("name"));
    const offered: readonly string[] = ctx.kind === "distributor" ? DISTRIBUTOR_API_SCOPES : API_SCOPES;
    const scopes = formData.getAll("scopes").map(String).filter((s) => offered.includes(s));
    if (!scopes.length) return { ok: false, error: "Choose at least one scope." };
    const expiresDays = Number(formData.get("expires") || 0);
    // Same format withApi authenticates: imk_<prefix>_<secret>, stored as sha256(key) with the prefix for lookup.
    const { key: secret, prefix, hash: keyHash } = generateApiKey();
    const { error } = await ctx.supabase.from("api_keys").insert({
      org_id: ctx.orgId,
      name,
      prefix,
      key_hash: keyHash,
      scopes,
      created_by: ctx.userId,
      expires_at: expiresDays > 0 ? new Date(Date.now() + expiresDays * 86_400_000).toISOString() : null,
    });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't create the key.") };
    refresh();
    return { ok: true, message: "Copy this key now — it won't be shown again.", data: { secret } };
  });
}

export async function revokeApiKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const id = uuid.parse(formData.get("id"));
    const { error } = await ctx.supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("org_id", ctx.orgId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Key revoked." };
  });
}


export async function createWebhook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const url = z.string().trim().url("Enter the full https:// URL").refine((u) => u.startsWith("https://"), "Webhooks must use https").parse(formData.get("url"));
    const events = formData.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (!events.length) return { ok: false, error: "Choose at least one event." };
    const { error } = await ctx.supabase.from("webhook_endpoints").insert({ org_id: ctx.orgId, url, events });
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Webhook endpoint added. Use the signing secret to verify deliveries." };
  });
}

export async function updateWebhook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const input = z.object({ id: uuid, op: z.enum(["enable", "disable", "delete"]) }).parse(Object.fromEntries(formData));
    const q = ctx.supabase.from("webhook_endpoints");
    const { error } = input.op === "delete"
      ? await q.delete().eq("id", input.id).eq("org_id", ctx.orgId)
      : await q.update({ active: input.op === "enable" }).eq("id", input.id).eq("org_id", ctx.orgId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true };
  });
}

/** Queue a `test.ping` delivery to one endpoint so the partner can check their signature code. */
export async function sendTestWebhook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const id = uuid.parse(formData.get("id"));
    const { data: hook } = await ctx.supabase.from("webhook_endpoints").select("id, active").eq("id", id).eq("org_id", ctx.orgId).maybeSingle();
    if (!hook) return { ok: false, error: "Endpoint not found." };
    if (!hook.active) return { ok: false, error: "Enable the endpoint before sending a test event." };
    const { queued } = await emitEvent(ctx.orgId, "test.ping", { message: "Hello from Covva", org_id: ctx.orgId, sent_at: new Date().toISOString() }, { endpointId: hook.id });
    if (!queued) return { ok: false, error: "Webhook delivery isn't configured on this environment (service key missing). Ask platform support." };
    refresh();
    return { ok: true, message: "Test event queued. The delivery log below updates once your endpoint responds." };
  });
}

// ---------------------------------------------------------------------------
// Insurer connector (platform enables; insurers describe their endpoint)
// ---------------------------------------------------------------------------
export async function saveConnector(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.orgAdmin });
    const input = z
      .object({
        level: z.enum(["portal", "quote_api", "policy_api"]),
        base_url: z.string().trim().url("Enter the API base URL").refine((u) => u.startsWith("https://"), "Use https").or(z.literal("")),
        auth_type: z.enum(["none", "api_key", "oauth2_client_credentials", "mtls", "basic"]),
        contact: z.string().trim().max(200).optional(),
      })
      .parse(Object.fromEntries(formData));
    if (input.level !== "portal" && !input.base_url) return { ok: false, error: "API connectors need a base URL." };
    const { data: existing } = await ctx.supabase.from("connector_configs").select("id, config").eq("insurer_org_id", ctx.orgId).maybeSingle();
    const config = { ...((existing?.config ?? {}) as Record<string, unknown>), technical_contact: input.contact || undefined };
    const row = { level: input.level, base_url: input.base_url || null, auth_type: input.auth_type, config: config as Json };
    const { error } = existing
      ? await ctx.supabase.from("connector_configs").update(row).eq("id", existing.id)
      : await ctx.supabase.from("connector_configs").insert({ ...row, insurer_org_id: ctx.orgId, status: "inactive" });
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Connector details saved. Platform operations will test and enable it." };
  });
}
