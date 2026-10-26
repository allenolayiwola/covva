import "server-only";
import type { Row } from "@im/db";
import { getCategories, type Category } from "@/lib/catalog";
import type { PartnerContext } from "./context";
import { colleagueNames } from "./privileged";

export interface TeamMember {
  membershipId: string;
  userId: string;
  role: Row<"memberships">["role"];
  team: string | null;
  title: string | null;
  isSupervisor: boolean;
  active: boolean;
  name: string;
  email: string | null;
}

/** Members of the active org (RLS: memberships readable by fellow members). */
export async function getTeam(ctx: PartnerContext, includeInactive = false): Promise<TeamMember[]> {
  let q = ctx.supabase
    .from("memberships")
    .select("id, user_id, role, team, title, is_supervisor, active")
    .eq("org_id", ctx.orgId)
    .order("created_at");
  if (!includeInactive) q = q.eq("active", true);
  const { data } = await q;
  const rows = data ?? [];
  const names = await colleagueNames(rows.map((r) => r.user_id));
  return rows.map((r) => {
    const p = names.get(r.user_id);
    const fallback = r.user_id === ctx.userId ? (ctx.userEmail ?? "You") : (r.title ?? "Team member");
    return {
      membershipId: r.id,
      userId: r.user_id,
      role: r.role,
      team: r.team,
      title: r.title,
      isSupervisor: r.is_supervisor,
      active: r.active,
      name: p?.name ?? p?.email ?? fallback,
      email: p?.email ?? (r.user_id === ctx.userId ? ctx.userEmail : null),
    };
  });
}

export function teamsOf(team: TeamMember[]): string[] {
  return [...new Set(team.map((m) => m.team).filter((t): t is string => !!t))].sort();
}

export type CustomerProfile = Pick<Row<"profiles">, "id" | "full_name" | "preferred_name" | "email" | "phone" | "account_type" | "business_name" | "kyc_status" | "region" | "city" | "created_at">;

/** Customer profiles visible through RLS (customers routed to this org). */
export async function getCustomers(ctx: PartnerContext, ids: string[]): Promise<Map<string, CustomerProfile>> {
  const out = new Map<string, CustomerProfile>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return out;
  const { data } = await ctx.supabase
    .from("profiles")
    .select("id, full_name, preferred_name, email, phone, account_type, business_name, kyc_status, region, city, created_at")
    .in("id", unique);
  for (const p of data ?? []) out.set(p.id, p);
  return out;
}

/** Names of brokers/insurers (public directory + own orgs via RLS). */
export async function getOrgNames(ctx: PartnerContext, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return out;
  const { data } = await ctx.supabase.from("organizations").select("id, name").in("id", unique);
  for (const o of data ?? []) out.set(o.id, o.name);
  return out;
}

export async function getCategoryMap(): Promise<Map<string, Category>> {
  const cats = await getCategories();
  return new Map(cats.map((c) => [c.id, c]));
}

/** "Ama Kumi" → "Ama K." as in the mockup's queue rows. */
export function shortName(p: { full_name?: string | null; preferred_name?: string | null; business_name?: string | null; email?: string | null } | undefined | null): string {
  if (!p) return "Customer";
  if (p.business_name) return p.business_name;
  const full = (p.preferred_name || p.full_name || "").trim();
  if (!full) return p.email?.split("@")[0] ?? "Customer";
  const parts = full.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : parts[0]!;
}

export function fullName(p: CustomerProfile | undefined | null): string {
  if (!p) return "Customer";
  return p.business_name || p.full_name || p.preferred_name || p.email || "Customer";
}

export const TYPE_LABEL: Record<Row<"requests">["type"], string> = {
  new_cover: "New cover",
  renewal: "Renewal",
  switch: "Switch",
  endorsement: "Endorsement",
  service: "Service",
};

export const SOURCE_LABEL: Record<Row<"requests">["source"], string> = {
  web: "Web",
  mobile: "Mobile",
  whatsapp: "WhatsApp",
  call_centre: "Assisted",
  admin: "Platform",
  api: "API",
};

/** Human description of a request for queue rows ("Motor renewal", "Travel cover"). */
export function requestKind(categoryName: string | undefined, type: Row<"requests">["type"]): string {
  const c = categoryName ?? "Insurance";
  return type === "new_cover" ? `${c} cover` : `${c} ${TYPE_LABEL[type].toLowerCase()}`;
}

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function isAtRisk(dueAt: string | null, now = Date.now()) {
  return !!dueAt && new Date(dueAt).getTime() - now < 4 * HOUR;
}

export const APPLICATION_LABEL: Record<Row<"applications">["status"], string> = {
  draft: "Draft",
  submitted: "Submitted to insurer",
  accepted: "Accepted by insurer",
  rejected: "Declined by insurer",
  withdrawn: "Withdrawn",
};
