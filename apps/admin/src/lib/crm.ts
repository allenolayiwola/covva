import "server-only";
import type { Row } from "@im/db";
import { requireStaff, resolveStaff, type Staff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { profileMap, type Supabase } from "@/lib/query";

export type CrmAccount = Row<"crm_accounts">;
export type CrmNote = Row<"crm_notes">;
export type CrmTask = Row<"crm_tasks">;
export type CrmMeeting = Row<"crm_meetings">;
export type CrmAttachment = Row<"crm_attachments">;
export type CrmStageEvent = Row<"crm_stage_events">;

export interface CrmContact {
  name?: string;
  email?: string;
  phone?: string;
  title?: string;
}

export function contactOf(a: Pick<CrmAccount, "contact">): CrmContact {
  const c = (a.contact ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof c[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : undefined);
  return { name: s("name"), email: s("email"), phone: s("phone"), title: s("title") };
}

/**
 * Who the signed-in staff member is to the CRM.
 *  - Partnerships Rep: platform membership with team = 'partnerships'
 *  - Partnerships Lead: rep with is_supervisor (or a platform admin)
 *  - canWrite: reps, leads, platform_admin, platform_ops (mirrors private.is_crm_writer)
 */
export interface CrmActor {
  staff: Staff;
  isRep: boolean;
  isLead: boolean;
  canWrite: boolean;
}

export async function crmActor(staff: Staff, supabase: Supabase): Promise<CrmActor> {
  const { data } = await supabase.from("memberships").select("team, is_supervisor").eq("user_id", staff.userId).eq("org_id", staff.orgId).eq("active", true);
  const rows = data ?? [];
  const isRep = rows.some((m) => m.team === "partnerships");
  const isLead = rows.some((m) => m.team === "partnerships" && m.is_supervisor) || staff.roles.includes("platform_admin");
  return { staff, isRep, isLead, canWrite: isRep || can(staff.roles, "crm") };
}

/** Page guard: any staff role may view the CRM. */
export async function requireCrm(): Promise<{ actor: CrmActor; supabase: Supabase }> {
  const staff = await requireStaff();
  const supabase = await createClient();
  return { actor: await crmActor(staff, supabase), supabase };
}

/** Server Action guard: re-verifies session, MFA, staff membership and CRM write access. */
export async function authorizeCrm(): Promise<{ ok: true; actor: CrmActor; supabase: Supabase } | { ok: false; error: string }> {
  const r = await resolveStaff();
  if (r.status === "anonymous") return { ok: false, error: "Your session has expired. Sign in again." };
  if (r.status === "mfa") return { ok: false, error: "Multi-factor verification is required. Reload the page to verify." };
  if (r.status === "forbidden") return { ok: false, error: "You are not a member of the platform staff." };
  const supabase = await createClient();
  const actor = await crmActor(r.staff, supabase);
  if (!actor.canWrite) {
    return { ok: false, error: `Your role (${r.staff.roles.join(", ")}) is read-only in the CRM. Partnerships reps (team = partnerships), platform admins and operations can write.` };
  }
  return { ok: true, actor, supabase };
}

export interface StaffMember {
  userId: string;
  name: string;
  email: string | null;
  team: string | null;
  isSupervisor: boolean;
  role: string;
}

/** Active platform staff (for owner / assignee pickers). Partnerships team first. */
export async function staffDirectory(supabase: Supabase, platformOrgId: string): Promise<StaffMember[]> {
  const { data } = await supabase.from("memberships").select("user_id, role, team, is_supervisor").eq("org_id", platformOrgId).eq("active", true);
  const rows = data ?? [];
  const profiles = await profileMap(supabase, rows.map((m) => m.user_id));
  const out = rows.map((m) => {
    const p = profiles.get(m.user_id);
    return { userId: m.user_id, name: p?.full_name || p?.email || m.user_id.slice(0, 8), email: p?.email ?? null, team: m.team, isSupervisor: m.is_supervisor, role: m.role };
  });
  const dedup = new Map<string, StaffMember>();
  for (const m of out) if (!dedup.has(m.userId) || m.team === "partnerships") dedup.set(m.userId, m);
  return [...dedup.values()].sort((a, b) => Number(b.team === "partnerships") - Number(a.team === "partnerships") || a.name.localeCompare(b.name));
}

export function adminUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function siteUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Short-lived signed download URL for a CRM attachment (private documents bucket). */
export async function attachmentUrl(supabase: Supabase, storagePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
  return data?.signedUrl ?? null;
}
