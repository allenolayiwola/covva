import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSINESS_ROLES,
  GROUP_SCHEME_CATEGORIES,
  businessCan,
  censusSummary,
  consolidateInvoice,
  groupComplexity,
  normalisePhone,
  normaliseRegistration,
  parseFleetCsv,
  parseMemberCsv,
  previousMonthPeriod,
  riskSchemaToZod,
  type BillablePolicy,
  type BusinessAction,
  type BusinessProfile,
  type BusinessRole,
  type CensusSummary,
  type CsvRowError,
  type FleetImportRow,
  type InvoicePeriod,
  type MemberImportRow,
  type RiskField,
} from "@im/core";
import type { Database, Enum, Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError, createRequest } from "@/server/requests";
import { initiatePayment } from "@/server/payments";
import { notify, notifyOrg, sendInviteEmail } from "@/server/notify";
import { log } from "@/server/log";
import { smeDb, type BusinessAssetRow, type BusinessInvoiceRow, type FleetVehicleRow, type GroupSchemeRow, type InvoiceLineDb, type SchemeMemberRow, type SmeDb, type AssetKind } from "@/server/sme-db";

/**
 * SME & group business accounts (Roadmap Phase 3).
 *
 * A business account is an `organizations` row of type `enterprise`; its people are `memberships` (owner / admin /
 * finance / viewer). Reads and writes go through the caller's RLS client wherever RLS allows them (members' PII is
 * only readable by owners/admins, the scheme's broker and insurer, staff and the member). The service client is used
 * after an explicit role check for system writes (linking a scheme to its quote request, building statements,
 * counts across tables the role cannot read) — never to widen what the caller sees.
 *
 * Money: a consolidated statement lists every insurer's premium, but each insurer line is paid separately through
 * `initiatePayment` (one `payments` row per insurer, settling to that insurer's subaccount) or the insurer's
 * instalment schedule. Covva never collects, holds or pools premiums.
 */
export type UserClient = SupabaseClient<Database>;
type Svc = ReturnType<typeof createServiceClient>;
type RequestClient = NonNullable<Parameters<typeof createRequest>[1]>["supabase"];
export interface BusinessCtx {
  supabase: UserClient;
  userId: string;
  source?: Enum<"request_source">;
}

const MAX_CSV_BYTES = 900 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r2 = (n: number) => Math.round(n * 100) / 100;
const db = (c: UserClient | Svc): SmeDb => smeDb(c as unknown as SupabaseClient<Database>);
const svcOrNull = (): Svc | null => {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
};
const requireSvc = (): Svc => {
  const svc = svcOrNull();
  if (!svc) throw new BusinessRuleError("This is temporarily unavailable. Please try again later.", "unavailable");
  return svc;
};

function assertUuid(id: string, what = "Record"): void {
  if (!UUID.test(id)) throw new BusinessRuleError(`${what} not found.`, "not_found");
}
function dbFail(err: { code?: string; message?: string } | null, fallback: string): never {
  if (err?.code === "P0001" && err.message) throw new BusinessRuleError(err.message);
  if (err?.code === "23505") throw new BusinessRuleError("That already exists.", "conflict");
  if (err?.code === "42501") throw new BusinessRuleError("You don't have permission to do that.", "forbidden");
  log.warn("business.db_error", { err });
  throw new BusinessRuleError(fallback);
}

// ---------------------------------------------------------------------------
// Accounts & roles
// ---------------------------------------------------------------------------
export interface BusinessAccount {
  orgId: string;
  name: string;
  slug: string;
  status: string;
  role: BusinessRole;
  team: string | null;
  profile: BusinessProfile;
  contactEmail: string | null;
  region: string | null;
}

/** Business accounts the user belongs to (active memberships of enterprise organisations). */
export async function myBusinessAccounts(ctx: BusinessCtx): Promise<BusinessAccount[]> {
  const { data: ms } = await ctx.supabase.from("memberships").select("org_id, role, team").eq("user_id", ctx.userId).eq("active", true);
  const ids = (ms ?? []).map((m) => m.org_id);
  if (!ids.length) return [];
  const { data: orgs } = await db(ctx.supabase).from("organizations").select("id, name, slug, status, type, business_profile, contact_email, region").in("id", ids).eq("type", "enterprise");
  const byId = new Map((orgs ?? []).map((o) => [o.id, o]));
  return (ms ?? [])
    .filter((m) => byId.has(m.org_id) && (BUSINESS_ROLES as readonly string[]).includes(m.role))
    .map((m) => {
      const o = byId.get(m.org_id)!;
      return {
        orgId: o.id,
        name: o.name,
        slug: o.slug,
        status: o.status,
        role: m.role as BusinessRole,
        team: m.team,
        profile: (o.business_profile ?? {}) as BusinessProfile,
        contactEmail: o.contact_email ?? null,
        region: o.region ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The caller's role in a business account; throws not_found / forbidden. */
export async function requireBusinessRole(ctx: BusinessCtx, orgId: string, action: BusinessAction = "view"): Promise<BusinessAccount> {
  assertUuid(orgId, "Business account");
  const account = (await myBusinessAccounts(ctx)).find((a) => a.orgId === orgId);
  if (!account || account.status === "offboarded") throw new BusinessRuleError("Business account not found.", "not_found");
  if (!businessCan(account.role, action)) {
    const what = action === "billing" ? "pay statements" : action === "members" ? "see member details" : "make changes";
    throw new BusinessRuleError(`Your role (${account.role}) can't ${what} for this business. Ask an owner or admin.`, "forbidden");
  }
  return account;
}

export interface CreateBusinessInput extends BusinessProfile {
  name: string;
  legal_name?: string;
  phone?: string;
  address?: string;
  region?: string;
}

/**
 * Create a business account: an enterprise organisation with the caller as owner (`create_business_account` RPC —
 * SECURITY DEFINER, max 5 owned accounts). `ownerUserId` must be the verified caller of `supabase`.
 */
export async function createBusinessAccount(ownerUserId: string, profile: CreateBusinessInput, opts: { supabase: UserClient }): Promise<{ orgId: string }> {
  const { data, error } = await db(opts.supabase).rpc("create_business_account", {
    p_name: profile.name,
    p_profile: {
      industry: profile.industry ?? null,
      employees: profile.employees ?? null,
      tin: profile.tin ?? null,
      registration_number: profile.registration_number ?? null,
      billing_email: profile.billing_email ?? null,
      billing_contact: profile.billing_contact ?? null,
      legal_name: profile.legal_name ?? null,
      phone: profile.phone ? normalisePhone(profile.phone) : null,
      address: profile.address ?? null,
      region: profile.region ?? null,
    } as Json,
  });
  if (error || !data) dbFail(error, "We couldn't create the business account. Please try again.");
  log.info("business.created", { orgId: data, ownerUserId });
  return { orgId: data as string };
}

/** Invite a colleague (owner/admin only). Reuses `invitations` + /invite/[token]; the DB limits business roles. */
export async function inviteBusinessUser(ctx: BusinessCtx, orgId: string, input: { email: string; role: BusinessRole; team?: string | null }): Promise<{ link: string; expiresAt: string }> {
  const account = await requireBusinessRole(ctx, orgId, "manage");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BusinessRuleError("Enter a valid email address.", "invalid_input");
  if (!(BUSINESS_ROLES as readonly string[]).includes(input.role)) throw new BusinessRuleError("Choose owner, admin, finance or viewer.", "invalid_input");
  if (input.role === "owner" && account.role !== "owner") throw new BusinessRuleError("Only an owner can invite another owner.", "forbidden");
  const { data: pending } = await ctx.supabase.from("invitations").select("id").eq("org_id", orgId).eq("email", email).is("accepted_at", null).gt("expires_at", new Date().toISOString()).limit(1);
  if (pending?.length) throw new BusinessRuleError("There is already a pending invitation for this email.", "conflict");
  const { data, error } = await ctx.supabase
    .from("invitations")
    .insert({ org_id: orgId, email, role: input.role, team: input.team?.trim() || null, invited_by: ctx.userId })
    .select("token, expires_at")
    .single();
  if (error || !data) dbFail(error, "We couldn't create the invitation.");
  const { data: me } = await ctx.supabase.from("profiles").select("full_name, preferred_name, email").eq("id", ctx.userId).maybeSingle();
  await sendInviteEmail({ to: email, orgName: account.name, role: input.role, token: data.token, invitedBy: me?.preferred_name || me?.full_name || me?.email, expiresAt: data.expires_at }).catch((err) => log.warn("business.invite_email_failed", { err }));
  return { link: `/invite/${data.token}`, expiresAt: data.expires_at };
}

export interface TeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  role: string;
  team: string | null;
  active: boolean;
  isYou: boolean;
}
export interface TeamView {
  members: TeamMember[];
  invitations: { id: string; email: string; role: string; team: string | null; expiresAt: string; createdAt: string }[];
}

export async function listTeam(ctx: BusinessCtx, orgId: string): Promise<TeamView> {
  const account = await requireBusinessRole(ctx, orgId, "view");
  const { data: ms } = await ctx.supabase.from("memberships").select("id, user_id, role, team, active").eq("org_id", orgId).order("created_at");
  const ids = (ms ?? []).map((m) => m.user_id);
  // Colleagues' names: profiles RLS doesn't cover co-workers, so read names/emails only, after the role check.
  const svc = svcOrNull();
  const { data: profiles } = svc && ids.length ? await svc.from("profiles").select("id, full_name, preferred_name, email").in("id", ids) : { data: [] as { id: string; full_name: string | null; preferred_name: string | null; email: string | null }[] };
  const pm = new Map((profiles ?? []).map((p) => [p.id, p]));
  const invitations = businessCan(account.role, "manage")
    ? ((await ctx.supabase.from("invitations").select("id, email, role, team, expires_at, created_at").eq("org_id", orgId).is("accepted_at", null).order("created_at", { ascending: false })).data ?? [])
    : [];
  return {
    members: (ms ?? []).map((m) => {
      const p = pm.get(m.user_id);
      return { membershipId: m.id, userId: m.user_id, name: p?.preferred_name || p?.full_name || p?.email || "Team member", email: p?.email ?? null, role: m.role, team: m.team, active: m.active, isYou: m.user_id === ctx.userId };
    }),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, team: i.team, expiresAt: i.expires_at, createdAt: i.created_at })),
  };
}

/** Change a colleague's role or deactivate them (owner/admin). The last active owner can't be removed or demoted. */
export async function updateTeamMember(ctx: BusinessCtx, orgId: string, membershipId: string, change: { role?: BusinessRole; active?: boolean }): Promise<void> {
  const account = await requireBusinessRole(ctx, orgId, "manage");
  assertUuid(membershipId, "Team member");
  const { data: all } = await ctx.supabase.from("memberships").select("id, user_id, role, active").eq("org_id", orgId);
  const target = (all ?? []).find((m) => m.id === membershipId);
  if (!target) throw new BusinessRuleError("Team member not found.", "not_found");
  if ((target.role === "owner" || change.role === "owner") && account.role !== "owner") throw new BusinessRuleError("Only an owner can change owners.", "forbidden");
  const owners = (all ?? []).filter((m) => m.role === "owner" && m.active);
  const losesOwner = target.role === "owner" && target.active && ((change.role && change.role !== "owner") || change.active === false);
  if (losesOwner && owners.length <= 1) throw new BusinessRuleError("A business account needs at least one active owner. Make someone else an owner first.");
  const patch: { role?: BusinessRole; active?: boolean } = {};
  if (change.role) patch.role = change.role;
  if (typeof change.active === "boolean") patch.active = change.active;
  const { error } = await ctx.supabase.from("memberships").update(patch).eq("id", membershipId).eq("org_id", orgId);
  if (error) dbFail(error, "We couldn't update that team member.");
}

// ---------------------------------------------------------------------------
// Schemes & members
// ---------------------------------------------------------------------------
export async function listSchemes(ctx: BusinessCtx, orgId: string): Promise<(GroupSchemeRow & { categoryName: string; categorySlug: string })[]> {
  await requireBusinessRole(ctx, orgId, "view");
  const { data } = await db(ctx.supabase).from("group_schemes").select("*").eq("business_org_id", orgId).order("created_at", { ascending: false });
  const cats = await categoryMap(ctx.supabase);
  return (data ?? []).map((s) => ({ ...s, categoryName: cats.get(s.category_id)?.name ?? "Group cover", categorySlug: cats.get(s.category_id)?.slug ?? "" }));
}

async function categoryMap(supabase: UserClient | Svc) {
  const { data } = await (supabase as UserClient).from("product_categories").select("id, slug, name, risk_schema, availability");
  return new Map((data ?? []).map((c) => [c.id, c]));
}

export async function createScheme(ctx: BusinessCtx, orgId: string, input: { name: string; categorySlug: string; notes?: string | null }): Promise<GroupSchemeRow> {
  await requireBusinessRole(ctx, orgId, "manage");
  if (!(GROUP_SCHEME_CATEGORIES as readonly string[]).includes(input.categorySlug)) throw new BusinessRuleError("Choose group health, group life & funeral or group personal accident.", "invalid_input");
  const { data: cat } = await ctx.supabase.from("product_categories").select("id").eq("slug", input.categorySlug).maybeSingle();
  if (!cat) throw new BusinessRuleError("That type of cover isn't available.", "not_found");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 160) throw new BusinessRuleError("Give the scheme a name (2–160 characters).", "invalid_input");
  const { data, error } = await db(ctx.supabase).from("group_schemes").insert({ business_org_id: orgId, category_id: cat.id, name, notes: input.notes?.trim() || null }).select("*").single();
  if (error || !data) dbFail(error, "We couldn't create the scheme.");
  return data;
}

async function loadScheme(ctx: BusinessCtx, schemeId: string): Promise<GroupSchemeRow> {
  assertUuid(schemeId, "Scheme");
  const { data } = await db(ctx.supabase).from("group_schemes").select("*").eq("id", schemeId).maybeSingle();
  if (!data) throw new BusinessRuleError("Scheme not found.", "not_found");
  return data;
}

export interface SchemeDetail {
  scheme: GroupSchemeRow;
  role: BusinessRole;
  categoryName: string;
  categorySlug: string;
  broker: { id: string; name: string; nic_licence_number: string | null } | null;
  insurer: { id: string; name: string } | null;
  policy: { id: string; internal_reference: string; policy_number: string | null; status: string; cover_start: string | null; cover_end: string | null; premium: number | null; billing_period: string } | null;
  request: { id: string; reference: string; status: string; next_step: string | null } | null;
  documents: { id: string; file_name: string | null; kind: string; created_at: string; storage_path: string | null }[];
  census: CensusSummary;
  /** Null when the role can't see member PII (finance / viewer). */
  members: SchemeMemberRow[] | null;
}

export async function schemeDetail(ctx: BusinessCtx, schemeId: string): Promise<SchemeDetail> {
  const scheme = await loadScheme(ctx, schemeId);
  const account = await requireBusinessRole(ctx, scheme.business_org_id, "view");
  const canSeeMembers = businessCan(account.role, "members");
  const svc = svcOrNull();
  const reader = db(canSeeMembers || !svc ? ctx.supabase : svc);
  const { data: members } = await reader.from("scheme_members").select("*").eq("scheme_id", schemeId).neq("status", "removed").order("relationship").order("full_name").limit(5000);
  const cats = await categoryMap(ctx.supabase);
  const orgIds = [scheme.broker_org_id, scheme.insurer_org_id].filter((x): x is string => !!x);
  const { data: orgs } = orgIds.length ? await (svc ?? ctx.supabase).from("organizations").select("id, name, nic_licence_number").in("id", orgIds) : { data: [] as { id: string; name: string; nic_licence_number: string | null }[] };
  const orgOf = (id: string | null) => (id ? (orgs ?? []).find((o) => o.id === id) ?? null : null);
  const [{ data: policy }, { data: request }, { data: documents }] = await Promise.all([
    scheme.policy_id ? (svc ?? ctx.supabase).from("policies").select("id, internal_reference, policy_number, status, cover_start, cover_end, premium, billing_period").eq("id", scheme.policy_id).maybeSingle() : Promise.resolve({ data: null }),
    scheme.request_id ? (svc ?? ctx.supabase).from("requests").select("id, reference, status, next_step").eq("id", scheme.request_id).maybeSingle() : Promise.resolve({ data: null }),
    scheme.policy_id && svc ? svc.from("documents").select("id, file_name, kind, created_at, storage_path").eq("policy_id", scheme.policy_id).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
  ]);
  const broker = orgOf(scheme.broker_org_id);
  const insurer = orgOf(scheme.insurer_org_id);
  return {
    scheme,
    role: account.role,
    categoryName: cats.get(scheme.category_id)?.name ?? "Group cover",
    categorySlug: cats.get(scheme.category_id)?.slug ?? "",
    broker: broker ? { id: broker.id, name: broker.name, nic_licence_number: broker.nic_licence_number } : null,
    insurer: insurer ? { id: insurer.id, name: insurer.name } : null,
    policy: policy ? { ...policy, premium: policy.premium != null ? Number(policy.premium) : null } : null,
    request: request ?? null,
    documents: (documents ?? []) as SchemeDetail["documents"],
    census: censusSummary(members ?? []),
    members: canSeeMembers ? (members ?? []) : null,
  };
}

export interface MemberInput {
  full_name: string;
  employee_ref?: string | null;
  date_of_birth?: string | null;
  gender?: "female" | "male" | "other" | null;
  phone?: string | null;
  email?: string | null;
  ghana_card?: string | null;
  relationship?: "employee" | "spouse" | "child" | "parent";
  principal_member_id?: string | null;
  cover_tier?: string | null;
  salary_band?: string | null;
}

/** Add one member (owner/admin). Phone normalised to +233…; only the last 4 Ghana Card digits are stored. */
export async function addMember(ctx: BusinessCtx, schemeId: string, input: MemberInput): Promise<SchemeMemberRow> {
  const scheme = await loadScheme(ctx, schemeId);
  await requireBusinessRole(ctx, scheme.business_org_id, "members");
  if (scheme.status === "cancelled") throw new BusinessRuleError("This scheme is cancelled.");
  const phone = input.phone?.trim() ? normalisePhone(input.phone) : null;
  if (phone && !/^\+233\d{9}$/.test(phone)) throw new BusinessRuleError("Enter a Ghana mobile number.", "invalid_input");
  const digits = (input.ghana_card ?? "").replace(/\D/g, "");
  const relationship = input.relationship ?? "employee";
  if (relationship !== "employee" && !input.principal_member_id) throw new BusinessRuleError("Choose the employee this dependant belongs to.", "invalid_input");
  const { data, error } = await db(ctx.supabase)
    .from("scheme_members")
    .insert({
      scheme_id: schemeId,
      full_name: input.full_name.trim().replace(/\s+/g, " "),
      employee_ref: input.employee_ref?.trim() || null,
      date_of_birth: input.date_of_birth || null,
      gender: input.gender ?? null,
      phone,
      email: input.email?.trim().toLowerCase() || null,
      ghana_card_last4: digits.length >= 4 ? digits.slice(-4) : null,
      relationship,
      principal_member_id: relationship === "employee" ? null : input.principal_member_id ?? null,
      cover_tier: input.cover_tier?.trim() || null,
      salary_band: input.salary_band?.trim() || null,
      status: "active",
    })
    .select("*")
    .single();
  if (error || !data) dbFail(error, "We couldn't add that member.");
  return data;
}

/** Mark a member (and their dependants, when an employee leaves) removed. Rows are never deleted. */
export async function removeMember(ctx: BusinessCtx, memberId: string): Promise<{ removed: number }> {
  assertUuid(memberId, "Member");
  const { data: m } = await db(ctx.supabase).from("scheme_members").select("id, scheme_id, relationship, status").eq("id", memberId).maybeSingle();
  if (!m) throw new BusinessRuleError("Member not found.", "not_found");
  const scheme = await loadScheme(ctx, m.scheme_id);
  await requireBusinessRole(ctx, scheme.business_org_id, "members");
  const today = new Date().toISOString().slice(0, 10);
  let removed = 0;
  if (m.relationship === "employee") {
    const { data: deps, error: depErr } = await db(ctx.supabase).from("scheme_members").update({ status: "removed", left_at: today }).eq("principal_member_id", memberId).neq("status", "removed").select("id");
    if (depErr) dbFail(depErr, "We couldn't remove the dependants.");
    removed += deps?.length ?? 0;
  }
  const { error } = await db(ctx.supabase).from("scheme_members").update({ status: "removed", left_at: today }).eq("id", memberId);
  if (error) dbFail(error, "We couldn't remove that member.");
  return { removed: removed + 1 };
}

export interface ImportReport<R> {
  mode: "preview" | "import";
  valid: number;
  errors: CsvRowError[];
  preview: R[];
  inserted: number;
  skipped: CsvRowError[];
}

function checkCsvSize(csv: string) {
  if (!csv.trim()) throw new BusinessRuleError("The file is empty.", "invalid_input");
  if (new TextEncoder().encode(csv).length > MAX_CSV_BYTES) throw new BusinessRuleError("The file is larger than 900 KB. Split it into smaller files.", "invalid_input");
}

/**
 * Bulk member upload (owner/admin). `preview` validates only (nothing is written); `import` inserts the valid rows —
 * employees first, then dependants linked by `principal_ref`. Rows already on the scheme (same employee_ref) are
 * skipped with a row-numbered reason. Invalid rows are never partially imported.
 */
export async function importMembers(ctx: BusinessCtx, schemeId: string, csv: string, opts: { mode?: "preview" | "import" } = {}): Promise<ImportReport<MemberImportRow>> {
  checkCsvSize(csv);
  const mode = opts.mode ?? "import";
  const scheme = await loadScheme(ctx, schemeId);
  await requireBusinessRole(ctx, scheme.business_org_id, "members");
  if (scheme.status === "cancelled") throw new BusinessRuleError("This scheme is cancelled.");
  const { data: existing } = await db(ctx.supabase).from("scheme_members").select("id, employee_ref, relationship").eq("scheme_id", schemeId).neq("status", "removed").limit(10000);
  const existingRefs = new Map((existing ?? []).filter((e) => e.relationship === "employee" && e.employee_ref).map((e) => [e.employee_ref!.toLowerCase(), e.id]));
  const parsed = parseMemberCsv(csv, { knownPrincipalRefs: [...existingRefs.keys()] });
  const skipped: CsvRowError[] = [];
  const rows = parsed.rows.filter((r) => {
    if (r.relationship === "employee" && r.employee_ref && existingRefs.has(r.employee_ref.toLowerCase())) {
      skipped.push({ row: r.row, message: `${r.employee_ref} is already on this scheme` });
      return false;
    }
    return true;
  });
  const base: ImportReport<MemberImportRow> = { mode, valid: rows.length, errors: parsed.errors, preview: rows.slice(0, 200), inserted: 0, skipped };
  if (mode === "preview" || !rows.length) return base;

  const toInsert = (r: MemberImportRow, principalId: string | null) => ({
    scheme_id: schemeId,
    employee_ref: r.employee_ref ?? null,
    full_name: r.full_name,
    date_of_birth: r.date_of_birth ?? null,
    gender: r.gender ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    ghana_card_last4: r.ghana_card_last4 ?? null,
    relationship: r.relationship,
    principal_member_id: principalId,
    cover_tier: r.cover_tier ?? null,
    salary_band: r.salary_band ?? null,
    status: "active" as const,
  });
  const refToId = new Map(existingRefs);
  let inserted = 0;
  const employees = rows.filter((r) => r.relationship === "employee");
  for (let i = 0; i < employees.length; i += 500) {
    const chunk = employees.slice(i, i + 500);
    const { data, error } = await db(ctx.supabase).from("scheme_members").insert(chunk.map((r) => toInsert(r, null))).select("id, employee_ref");
    if (error) dbFail(error, `We couldn't import rows ${chunk[0]!.row}–${chunk[chunk.length - 1]!.row}. Nothing from this batch was saved.`);
    for (const d of data ?? []) if (d.employee_ref) refToId.set(d.employee_ref.toLowerCase(), d.id);
    inserted += data?.length ?? 0;
  }
  const dependants = rows.filter((r) => r.relationship !== "employee");
  const ready = dependants.filter((r) => {
    if (refToId.has((r.principal_ref ?? "").toLowerCase())) return true;
    skipped.push({ row: r.row, message: `principal ${r.principal_ref} was not imported` });
    return false;
  });
  for (let i = 0; i < ready.length; i += 500) {
    const chunk = ready.slice(i, i + 500);
    const { data, error } = await db(ctx.supabase).from("scheme_members").insert(chunk.map((r) => toInsert(r, refToId.get(r.principal_ref!.toLowerCase())!))).select("id");
    if (error) dbFail(error, `We couldn't import dependants on rows ${chunk[0]!.row}–${chunk[chunk.length - 1]!.row}.`);
    inserted += data?.length ?? 0;
  }
  log.info("business.members_imported", { schemeId, inserted, errors: parsed.errors.length, skipped: skipped.length });
  return { ...base, inserted, skipped };
}

// ---------------------------------------------------------------------------
// Fleet & assets
// ---------------------------------------------------------------------------
export async function listFleet(ctx: BusinessCtx, orgId: string, opts: { includeRemoved?: boolean } = {}): Promise<FleetVehicleRow[]> {
  await requireBusinessRole(ctx, orgId, "view");
  let q = db(ctx.supabase).from("fleet_vehicles").select("*").eq("business_org_id", orgId).order("registration").limit(5000);
  if (!opts.includeRemoved) q = q.eq("status", "active");
  const { data } = await q;
  return data ?? [];
}

export interface VehicleInput {
  registration: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  value?: number | null;
  use?: "private" | "commercial" | "hire";
  driver_name?: string | null;
}

export async function addVehicle(ctx: BusinessCtx, orgId: string, input: VehicleInput): Promise<FleetVehicleRow> {
  await requireBusinessRole(ctx, orgId, "manage");
  const registration = normaliseRegistration(input.registration);
  if (registration.length < 2) throw new BusinessRuleError("Enter the registration number.", "invalid_input");
  const { data, error } = await db(ctx.supabase)
    .from("fleet_vehicles")
    .insert({ business_org_id: orgId, registration, make: input.make?.trim() || null, model: input.model?.trim() || null, year: input.year ?? null, value: input.value ?? null, use: input.use ?? "private", driver_name: input.driver_name?.trim() || null })
    .select("*")
    .single();
  if (error?.code === "23505") throw new BusinessRuleError(`${registration} is already on your fleet.`, "conflict");
  if (error || !data) dbFail(error, "We couldn't add that vehicle.");
  return data;
}

export async function removeVehicle(ctx: BusinessCtx, vehicleId: string): Promise<void> {
  assertUuid(vehicleId, "Vehicle");
  const { data: v } = await db(ctx.supabase).from("fleet_vehicles").select("id, business_org_id").eq("id", vehicleId).maybeSingle();
  if (!v) throw new BusinessRuleError("Vehicle not found.", "not_found");
  await requireBusinessRole(ctx, v.business_org_id, "manage");
  const { error } = await db(ctx.supabase).from("fleet_vehicles").update({ status: "removed" }).eq("id", vehicleId);
  if (error) dbFail(error, "We couldn't remove that vehicle.");
}

/** Bulk fleet upload (owner/admin): preview validates only; import inserts the valid rows. */
export async function importFleet(ctx: BusinessCtx, orgId: string, csv: string, opts: { mode?: "preview" | "import" } = {}): Promise<ImportReport<FleetImportRow>> {
  checkCsvSize(csv);
  const mode = opts.mode ?? "import";
  await requireBusinessRole(ctx, orgId, "manage");
  const { data: existing } = await db(ctx.supabase).from("fleet_vehicles").select("registration").eq("business_org_id", orgId).eq("status", "active").limit(10000);
  const parsed = parseFleetCsv(csv, { existingRegistrations: (existing ?? []).map((e) => e.registration) });
  const base: ImportReport<FleetImportRow> = { mode, valid: parsed.rows.length, errors: parsed.errors, preview: parsed.rows.slice(0, 200), inserted: 0, skipped: [] };
  if (mode === "preview" || !parsed.rows.length) return base;
  let inserted = 0;
  for (let i = 0; i < parsed.rows.length; i += 500) {
    const chunk = parsed.rows.slice(i, i + 500);
    const { data, error } = await db(ctx.supabase)
      .from("fleet_vehicles")
      .insert(chunk.map((r) => ({ business_org_id: orgId, registration: r.registration, make: r.make ?? null, model: r.model ?? null, year: r.year ?? null, value: r.value ?? null, use: r.use, driver_name: r.driver_name ?? null })))
      .select("id");
    if (error) dbFail(error, `We couldn't import rows ${chunk[0]!.row}–${chunk[chunk.length - 1]!.row}. Nothing from this batch was saved.`);
    inserted += data?.length ?? 0;
  }
  log.info("business.fleet_imported", { orgId, inserted, errors: parsed.errors.length });
  return { ...base, inserted };
}

export async function listAssets(ctx: BusinessCtx, orgId: string): Promise<BusinessAssetRow[]> {
  await requireBusinessRole(ctx, orgId, "view");
  const { data } = await db(ctx.supabase).from("business_assets").select("*").eq("business_org_id", orgId).eq("status", "active").order("created_at", { ascending: false }).limit(2000);
  return data ?? [];
}

export async function addAsset(ctx: BusinessCtx, orgId: string, input: { kind: AssetKind; description: string; address?: string | null; value?: number | null }): Promise<BusinessAssetRow> {
  await requireBusinessRole(ctx, orgId, "manage");
  const { data, error } = await db(ctx.supabase)
    .from("business_assets")
    .insert({ business_org_id: orgId, kind: input.kind, description: input.description.trim(), address: input.address?.trim() || null, value: input.value ?? null })
    .select("*")
    .single();
  if (error || !data) dbFail(error, "We couldn't add that asset.");
  return data;
}

export async function removeAsset(ctx: BusinessCtx, assetId: string): Promise<void> {
  assertUuid(assetId, "Asset");
  const { data: a } = await db(ctx.supabase).from("business_assets").select("id, business_org_id").eq("id", assetId).maybeSingle();
  if (!a) throw new BusinessRuleError("Asset not found.", "not_found");
  await requireBusinessRole(ctx, a.business_org_id, "manage");
  const { error } = await db(ctx.supabase).from("business_assets").update({ status: "removed" }).eq("id", assetId);
  if (error) dbFail(error, "We couldn't remove that asset.");
}

// ---------------------------------------------------------------------------
// Quotes (all business requests are broker-routed)
// ---------------------------------------------------------------------------
async function orgSummary(ctx: BusinessCtx, orgId: string) {
  const account = await requireBusinessRole(ctx, orgId, "manage");
  return { account, business: { business_name: account.name, industry: account.profile.industry ?? null, employees: account.profile.employees ?? null } };
}

/**
 * Ask for group quotes for a scheme: a request on the scheme's category with `business_org_id`, `risk_data` = the
 * census summary + size keys (`lives`) — never names, phones or IDs. Routed by the existing engine; business requests
 * always go to a broker (≥ 20 lives also raises the `group_scheme` complexity flag).
 */
export async function requestGroupQuote(ctx: BusinessCtx, schemeId: string, opts: { notes?: string | null } = {}) {
  const scheme = await loadScheme(ctx, schemeId);
  const { account, business } = await orgSummary(ctx, scheme.business_org_id);
  if (scheme.status === "cancelled") throw new BusinessRuleError("This scheme is cancelled.");
  const svc = requireSvc();
  if (scheme.request_id) {
    const { data: open } = await svc.from("requests").select("id, reference, status").eq("id", scheme.request_id).maybeSingle();
    if (open && !["completed", "cancelled", "closed_no_cover"].includes(open.status)) {
      throw new BusinessRuleError(`Quote request ${open.reference} is still open for this scheme. Follow it from your requests.`, "conflict");
    }
  }
  const { data: members } = await db(ctx.supabase).from("scheme_members").select("relationship, date_of_birth, gender, cover_tier, salary_band, status").eq("scheme_id", schemeId).neq("status", "removed").limit(10000);
  const census = censusSummary(members ?? []);
  if (census.lives < 1) throw new BusinessRuleError("Add the members (or upload your census) before asking for quotes.");
  const size = groupComplexity(members ?? []);
  const { data: cat } = await ctx.supabase.from("product_categories").select("slug, name").eq("id", scheme.category_id).single();
  if (!cat) throw new BusinessRuleError("This scheme's type of cover is not available.");
  const risk: Record<string, unknown> = {
    scheme_type: "group",
    scheme_id: scheme.id,
    scheme_reference: scheme.reference,
    ...business,
    ...size.riskKeys,
    employees_on_scheme: census.employees,
    dependants: census.dependants,
    census,
    renewal_of_policy: scheme.policy_id ?? null,
    notes: opts.notes?.trim().slice(0, 1000) || null,
  };
  const result = await createRequest(
    {
      categorySlug: cat.slug,
      risk,
      source: ctx.source ?? "web",
      relatedPolicyId: scheme.policy_id ?? undefined,
      type: scheme.policy_id ? "renewal" : "new_cover",
      brokerOfRecordId: scheme.broker_org_id,
      business: { orgId: scheme.business_org_id, title: `Group ${cat.name.toLowerCase()} · ${scheme.name} · ${census.lives} lives`, groupRisk: true },
    },
    { supabase: ctx.supabase as RequestClient, userId: ctx.userId },
  );
  const { error } = await db(svc).from("group_schemes").update({ request_id: result.request.id, status: scheme.status === "draft" ? "quoting" : scheme.status }).eq("id", schemeId);
  if (error) log.warn("business.scheme_link_failed", { schemeId, err: error });
  log.info("business.group_quote", { schemeId, requestId: result.request.id, lives: census.lives, flags: result.routing.complexityFlags, org: account.orgId });
  return { requestId: result.request.id, reference: result.request.reference, status: result.request.status, routing: { mode: result.routing.mode, complexityFlags: result.routing.complexityFlags } };
}

/** Fleet motor quotes for some or all active vehicles (ids travel in risk_data so issuance links the policy). */
export async function requestFleetQuote(ctx: BusinessCtx, orgId: string, vehicleIds?: string[] | null, opts: { coverType?: string; region?: string | null; notes?: string | null } = {}) {
  const { business } = await orgSummary(ctx, orgId);
  let q = db(ctx.supabase).from("fleet_vehicles").select("*").eq("business_org_id", orgId).eq("status", "active");
  if (vehicleIds?.length) {
    vehicleIds.forEach((id) => assertUuid(id, "Vehicle"));
    q = q.in("id", vehicleIds);
  }
  const { data: vehicles } = await q.limit(5000);
  const list = vehicles ?? [];
  if (!list.length) throw new BusinessRuleError("Add vehicles to your fleet before asking for quotes.");
  const size = groupComplexity([], list);
  const byUse: Record<string, number> = {};
  for (const v of list) byUse[v.use] = (byUse[v.use] ?? 0) + 1;
  const years = list.map((v) => v.year).filter((y): y is number => typeof y === "number");
  const total = r2(list.reduce((s, v) => s + (Number(v.value) || 0), 0));
  const risk: Record<string, unknown> = {
    scheme_type: "fleet",
    ...business,
    ...size.riskKeys,
    fleet_vehicle_ids: list.map((v) => v.id),
    vehicles_by_use: byUse,
    total_sum_insured: total || null,
    oldest_vehicle_year: years.length ? Math.min(...years) : null,
    newest_vehicle_year: years.length ? Math.max(...years) : null,
    cover_type: opts.coverType ?? "comprehensive",
    region: opts.region ?? null,
    notes: opts.notes?.trim().slice(0, 1000) || null,
  };
  const result = await createRequest(
    { categorySlug: "motor", risk, source: ctx.source ?? "web", business: { orgId, title: `Fleet motor · ${business.business_name} · ${list.length} vehicle${list.length === 1 ? "" : "s"}`, groupRisk: true } },
    { supabase: ctx.supabase as RequestClient, userId: ctx.userId },
  );
  return { requestId: result.request.id, reference: result.request.reference, status: result.request.status, vehicles: list.length, routing: { mode: result.routing.mode, complexityFlags: result.routing.complexityFlags } };
}

export interface PropertyQuoteInput {
  categorySlug: "sme-property" | "liability";
  assetIds?: string[] | null;
  /** Category form answers (validated against the category's risk schema), e.g. region, business_interruption. */
  details?: Record<string, unknown>;
}

/** Business property & stock or liability quotes, prefilled from the business's assets. */
export async function requestPropertyQuote(ctx: BusinessCtx, orgId: string, input: PropertyQuoteInput) {
  const { business } = await orgSummary(ctx, orgId);
  if (input.categorySlug !== "sme-property" && input.categorySlug !== "liability") throw new BusinessRuleError("Choose property & stock or liability cover.", "invalid_input");
  let q = db(ctx.supabase).from("business_assets").select("*").eq("business_org_id", orgId).eq("status", "active");
  if (input.assetIds?.length) {
    input.assetIds.forEach((id) => assertUuid(id, "Asset"));
    q = q.in("id", input.assetIds);
  }
  const { data: assets } = await q.limit(2000);
  const list = assets ?? [];
  const sum = (kind: AssetKind) => r2(list.filter((a) => a.kind === kind).reduce((s, a) => s + (Number(a.value) || 0), 0));
  const prefill: Record<string, unknown> =
    input.categorySlug === "sme-property"
      ? { business_name: business.business_name, business_type: business.industry ?? "", premises_value: sum("property") || undefined, stock_value: sum("stock"), equipment_value: sum("equipment"), employees: business.employees ?? 0 }
      : { profession: business.industry ?? "" };
  const { data: cat } = await ctx.supabase.from("product_categories").select("risk_schema").eq("slug", input.categorySlug).maybeSingle();
  if (!cat) throw new BusinessRuleError("That type of cover isn't available.", "not_found");
  const answers = { ...prefill, ...(input.details ?? {}) };
  const parsed = riskSchemaToZod(cat.risk_schema as unknown as RiskField[]).safeParse(answers);
  if (!parsed.success) throw new BusinessRuleError(parsed.error.issues.map((i) => i.message).join(" "), "invalid_input");
  const risk: Record<string, unknown> = {
    ...(parsed.data as Record<string, unknown>),
    scheme_type: input.categorySlug === "sme-property" ? "property" : "liability",
    business_asset_ids: list.map((a) => a.id),
    exposures: list.filter((a) => a.kind === "liability_exposure").map((a) => a.description).slice(0, 50),
    industry: business.industry,
  };
  const result = await createRequest(
    { categorySlug: input.categorySlug, risk, source: ctx.source ?? "web", business: { orgId, title: `${input.categorySlug === "sme-property" ? "Business property & stock" : "Liability"} · ${business.business_name}`, groupRisk: true } },
    { supabase: ctx.supabase as RequestClient, userId: ctx.userId },
  );
  return { requestId: result.request.id, reference: result.request.reference, status: result.request.status, assets: list.length, routing: { mode: result.routing.mode, complexityFlags: result.routing.complexityFlags } };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export interface BusinessDashboard {
  account: BusinessAccount;
  schemes: { id: string; reference: string; name: string; status: string; categoryName: string; memberCount: number; renewalDate: string | null }[];
  members: { total: number; employees: number | null };
  fleet: { active: number; insured: number; totalValue: number };
  assets: { active: number; totalValue: number };
  renewals: { kind: "scheme" | "policy"; id: string; label: string; date: string; days: number }[];
  invoicesDue: { id: string; reference: string; total: number; currency: string; dueAt: string | null; status: string }[];
  openRequests: number;
  /** Claims on the business's policies — a count only (claims belong to the policyholder and the insurer). */
  claims: { open: number; total: number };
}

export async function businessDashboard(ctx: BusinessCtx, orgId: string, now = new Date()): Promise<BusinessDashboard> {
  const account = await requireBusinessRole(ctx, orgId, "view");
  // Access is already checked above. The service client lets the dashboard count employees' claims
  // (counts only); without it, fall back to the member's own client so the page still renders
  // (RLS covers the business's schemes, requests and policies; claim counts then show what RLS allows).
  const svc = svcOrNull() ?? (ctx.supabase as unknown as Svc);
  const sdb = db(svc);
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: schemes }, { data: fleet }, { data: assets }, { data: reqs }, { data: invoices }, cats] = await Promise.all([
    sdb.from("group_schemes").select("*").eq("business_org_id", orgId).order("created_at", { ascending: false }),
    sdb.from("fleet_vehicles").select("id, value, policy_id").eq("business_org_id", orgId).eq("status", "active").limit(5000),
    sdb.from("business_assets").select("id, value").eq("business_org_id", orgId).eq("status", "active").limit(2000),
    svc.from("requests").select("id, status").eq("business_org_id", orgId).limit(2000),
    sdb.from("business_invoices").select("id, reference, total, currency, due_at, status").eq("business_org_id", orgId).in("status", ["issued", "overdue"]).order("due_at"),
    categoryMap(svc),
  ]);
  const reqIds = (reqs ?? []).map((r) => r.id);
  const { data: policies } = reqIds.length ? await svc.from("policies").select("id, internal_reference, policy_number, cover_end, status, category_id").in("request_id", reqIds).in("status", ["active", "pending_issuance"]) : { data: [] as { id: string; internal_reference: string; policy_number: string | null; cover_end: string | null; status: string; category_id: string }[] };
  const policyIds = (policies ?? []).map((p) => p.id);
  const [{ count: claimsTotal }, { count: claimsOpen }, employees] = await Promise.all([
    policyIds.length ? svc.from("claims").select("id", { count: "exact", head: true }).in("policy_id", policyIds) : Promise.resolve({ count: 0 }),
    policyIds.length ? svc.from("claims").select("id", { count: "exact", head: true }).in("policy_id", policyIds).not("status", "in", "(paid,closed,rejected,withdrawn,draft)") : Promise.resolve({ count: 0 }),
    (schemes ?? []).length
      ? sdb.from("scheme_members").select("id", { count: "exact", head: true }).in("scheme_id", (schemes ?? []).map((s) => s.id)).eq("relationship", "employee").neq("status", "removed").then((r) => r.count ?? 0)
      : Promise.resolve(0),
  ]);
  const days = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const renewals: BusinessDashboard["renewals"] = [];
  for (const s of schemes ?? []) {
    if (s.renewal_date && s.renewal_date >= today && s.renewal_date <= horizon && s.status !== "cancelled") renewals.push({ kind: "scheme", id: s.id, label: s.name, date: s.renewal_date, days: days(s.renewal_date) });
  }
  const schemePolicyIds = new Set((schemes ?? []).map((s) => s.policy_id).filter(Boolean));
  for (const p of policies ?? []) {
    if (!schemePolicyIds.has(p.id) && p.cover_end && p.cover_end >= today && p.cover_end <= horizon) {
      renewals.push({ kind: "policy", id: p.id, label: `${cats.get(p.category_id)?.name ?? "Policy"} ${p.policy_number ?? p.internal_reference}`, date: p.cover_end, days: days(p.cover_end) });
    }
  }
  renewals.sort((a, b) => a.date.localeCompare(b.date));
  return {
    account,
    schemes: (schemes ?? []).filter((s) => s.status !== "cancelled").map((s) => ({ id: s.id, reference: s.reference, name: s.name, status: s.status, categoryName: cats.get(s.category_id)?.name ?? "Group cover", memberCount: s.member_count, renewalDate: s.renewal_date })),
    members: { total: (schemes ?? []).filter((s) => s.status !== "cancelled").reduce((n, s) => n + s.member_count, 0), employees: businessCan(account.role, "members") ? employees : null },
    fleet: { active: (fleet ?? []).length, insured: (fleet ?? []).filter((v) => v.policy_id).length, totalValue: r2((fleet ?? []).reduce((s, v) => s + (Number(v.value) || 0), 0)) },
    assets: { active: (assets ?? []).length, totalValue: r2((assets ?? []).reduce((s, a) => s + (Number(a.value) || 0), 0)) },
    renewals,
    invoicesDue: (invoices ?? []).map((i) => ({ id: i.id, reference: i.reference, total: Number(i.total), currency: i.currency, dueAt: i.due_at, status: i.status })),
    openRequests: (reqs ?? []).filter((r) => !["completed", "cancelled", "closed_no_cover"].includes(r.status)).length,
    claims: { open: claimsOpen ?? 0, total: claimsTotal ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Consolidated billing
// ---------------------------------------------------------------------------
type InstalmentsModule = typeof import("@/server/instalments");

/** The instalments engine ships with the Phase 3 instalments stream; billing degrades gracefully without it. */
async function instalmentsModule(): Promise<InstalmentsModule | null> {
  try {
    return await import("@/server/instalments");
  } catch {
    return null;
  }
}

export function invoiceLines(inv: Pick<BusinessInvoiceRow, "lines">): InvoiceLineDb[] {
  return Array.isArray(inv.lines) ? (inv.lines as unknown as InvoiceLineDb[]) : [];
}

/**
 * Build (or refresh) the consolidated statement of a business for a period: new business awaiting payment, policy
 * premiums falling due and instalments due. Idempotent per (business, period); a paid statement is never rewritten.
 * Returns null when nothing is due.
 */
export async function buildInvoice(svc: Svc, orgId: string, period: InvoicePeriod = previousMonthPeriod()): Promise<BusinessInvoiceRow | null> {
  const sdb = db(svc);
  const { data: existing } = await sdb.from("business_invoices").select("*").eq("business_org_id", orgId).eq("period_start", period.start).eq("period_end", period.end).maybeSingle();
  if (existing && existing.status === "paid") return existing;
  const keep = new Map(existing ? invoiceLines(existing).filter((l) => l.payment_id).map((l) => [lineKey(l), l]) : []);

  const { data: reqs } = await svc.from("requests").select("id").eq("business_org_id", orgId).limit(5000);
  const reqIds = (reqs ?? []).map((r) => r.id);
  if (!reqIds.length) return existing ?? null;
  const [{ data: policies }, { data: schemes }, { data: apps }] = await Promise.all([
    svc.from("policies").select("id, request_id, insurer_org_id, category_id, premium, billing_period, cover_start, cover_end, status, currency, internal_reference, policy_number").in("request_id", reqIds).in("status", ["active", "renewed"]),
    sdb.from("group_schemes").select("id, policy_id, name").eq("business_org_id", orgId),
    svc.from("applications").select("id, quote_id, request_id, status").in("request_id", reqIds).in("status", ["submitted", "accepted"]),
  ]);
  const quoteIds = (apps ?? []).map((a) => a.quote_id);
  const appIds = (apps ?? []).map((a) => a.id);
  const [{ data: quotes }, { data: paid }] = await Promise.all([
    quoteIds.length ? svc.from("quotes").select("id, insurer_org_id, premium, taxes, fees, status, currency, request_id").in("id", quoteIds) : Promise.resolve({ data: [] as { id: string; insurer_org_id: string; premium: number; taxes: number; fees: number; status: string; currency: string; request_id: string }[] }),
    appIds.length ? svc.from("payments").select("application_id").in("application_id", appIds).eq("status", "succeeded") : Promise.resolve({ data: [] as { application_id: string | null }[] }),
  ]);
  const paidApps = new Set((paid ?? []).map((p) => p.application_id));
  const insurerIds = [...new Set([...(policies ?? []).map((p) => p.insurer_org_id), ...(quotes ?? []).map((q) => q.insurer_org_id)].filter((x): x is string => !!x))];
  const [{ data: insurers }, cats] = await Promise.all([
    insurerIds.length ? svc.from("organizations").select("id, name").in("id", insurerIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    categoryMap(svc),
  ]);
  const insurerName = new Map((insurers ?? []).map((i) => [i.id, i.name]));
  const schemeOf = new Map((schemes ?? []).filter((s) => s.policy_id).map((s) => [s.policy_id!, s]));

  const billable: BillablePolicy[] = [];
  const instalmentLines: InvoiceLineDb[] = [];
  const inst = await instalmentsModule();
  for (const p of policies ?? []) {
    // Externally bought policies without an insurer on Covva are not billed here.
    if (!p.insurer_org_id) continue;
    const insurerOrgId = p.insurer_org_id;
    const scheme = schemeOf.get(p.id);
    const description = `${scheme ? `${scheme.name} · ` : ""}${cats.get(p.category_id)?.name ?? "Policy"} ${p.policy_number ?? p.internal_reference}`;
    const view = inst ? await inst.scheduleForPolicy(p.id).catch(() => null) : null;
    if (view) {
      // Paid by instalments: bill the instalments due in the period (the insurer's schedule is the source of truth).
      for (const i of view.instalments) {
        const due = i.due_at.slice(0, 10);
        if ((i.status === "due" || i.status === "failed" || i.status === "pending") && due >= period.start && due <= period.end) {
          instalmentLines.push({ policy_id: p.id, scheme_id: scheme?.id ?? null, application_id: null, instalment_id: i.id, description: `${description} · instalment ${i.seq}`, amount: r2(Number(i.amount)), insurer_org_id: insurerOrgId, insurer_name: insurerName.get(insurerOrgId) ?? null, basis: "instalment" });
        }
      }
      continue;
    }
    billable.push({ policy_id: p.id, scheme_id: scheme?.id ?? null, insurer_org_id: insurerOrgId, insurer_name: insurerName.get(insurerOrgId) ?? null, description, premium: Number(p.premium ?? 0), billing_period: p.billing_period, cover_start: p.cover_start, cover_end: p.cover_end, status: p.status, currency: p.currency });
  }
  const quoteOf = new Map((quotes ?? []).map((q) => [q.id, q]));
  for (const a of apps ?? []) {
    if (paidApps.has(a.id)) continue;
    const q = quoteOf.get(a.quote_id);
    if (!q || q.status !== "ready_to_accept") continue;
    billable.push({ application_id: a.id, insurer_org_id: q.insurer_org_id, insurer_name: insurerName.get(q.insurer_org_id) ?? null, description: "New cover awaiting payment", premium: Number(q.premium) + Number(q.taxes) + Number(q.fees), currency: q.currency });
  }
  const consolidated = consolidateInvoice(billable, period);
  const lines: InvoiceLineDb[] = [...consolidated.lines.map((l) => ({ ...l })), ...instalmentLines].map((l) => {
    const prior = keep.get(lineKey(l));
    return prior ? { ...l, payment_id: prior.payment_id, payment_status: prior.payment_status } : l;
  });
  if (!lines.length) return existing ?? null;
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  const nowIso = new Date().toISOString();
  const row = {
    business_org_id: orgId,
    period_start: period.start,
    period_end: period.end,
    currency: consolidated.currency,
    total,
    lines: lines as unknown as Json,
    status: "issued" as const,
    issued_at: existing?.issued_at ?? nowIso,
    due_at: existing?.due_at ?? new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
  const { data, error } = await sdb.from("business_invoices").upsert(row, { onConflict: "business_org_id,period_start,period_end" }).select("*").single();
  if (error || !data) {
    log.warn("business.invoice_failed", { orgId, err: error });
    return existing ?? null;
  }
  if (!existing) {
    await notifyOrg(orgId, {
      kind: "business.invoice.issued",
      title: `Statement ${data.reference}: ${data.currency} ${total.toFixed(2)} due`,
      body: `Your consolidated statement for ${period.start} to ${period.end} is ready. Each insurer is paid separately — premiums go straight to the insurer.`,
      link: `/account/business/invoices?org=${orgId}`,
      data: { invoice_id: data.id, org_id: orgId },
      channels: ["in_app", "email"],
    }, ["owner", "admin", "finance"]).catch(() => {});
  }
  return data;
}

const lineKey = (l: Pick<InvoiceLineDb, "policy_id" | "application_id" | "instalment_id" | "insurer_org_id">) => `${l.application_id ?? ""}|${l.instalment_id ?? ""}|${l.policy_id ?? ""}|${l.insurer_org_id}`;

/** Cron `business-invoices` (1st of the month, 05:00): statements for last month + overdue marking. Idempotent. */
export async function buildDueInvoices(svc: Svc): Promise<Record<string, unknown>> {
  const period = previousMonthPeriod();
  const { data: orgs } = await svc.from("organizations").select("id").eq("type", "enterprise").eq("status", "active").limit(5000);
  let built = 0;
  for (const o of orgs ?? []) {
    try {
      if (await buildInvoice(svc, o.id, period)) built++;
    } catch (err) {
      log.warn("business.invoice_cron_failed", { orgId: o.id, err });
    }
  }
  const { data: overdue } = await db(svc).from("business_invoices").update({ status: "overdue" }).eq("status", "issued").lt("due_at", new Date().toISOString()).select("id");
  return { period, businesses: orgs?.length ?? 0, built, overdue: overdue?.length ?? 0 };
}

/** Refresh line payment statuses from `payments`; mark the statement paid when every line has settled. */
async function refreshInvoice(svc: Svc, inv: BusinessInvoiceRow): Promise<BusinessInvoiceRow> {
  const lines = invoiceLines(inv);
  const ids = lines.map((l) => l.payment_id).filter((x): x is string => !!x);
  if (!ids.length || inv.status === "paid") return inv;
  const { data: pays } = await svc.from("payments").select("id, status, paid_at").in("id", ids);
  const st = new Map((pays ?? []).map((p) => [p.id, p]));
  let changed = false;
  const next = lines.map((l) => {
    const p = l.payment_id ? st.get(l.payment_id) : undefined;
    if (p && p.status !== l.payment_status) {
      changed = true;
      return { ...l, payment_status: p.status };
    }
    return l;
  });
  const allPaid = next.length > 0 && next.every((l) => l.payment_status === "succeeded");
  if (!changed && !allPaid) return inv;
  const patch = { lines: next as unknown as Json, ...(allPaid ? { status: "paid" as const, paid_at: new Date().toISOString() } : {}) };
  const { data } = await db(svc).from("business_invoices").update(patch).eq("id", inv.id).select("*").single();
  return data ?? inv;
}

export async function listInvoices(ctx: BusinessCtx, orgId: string): Promise<BusinessInvoiceRow[]> {
  await requireBusinessRole(ctx, orgId, "view");
  const { data } = await db(ctx.supabase).from("business_invoices").select("*").eq("business_org_id", orgId).order("period_start", { ascending: false }).limit(60);
  const svc = svcOrNull();
  if (!svc) return data ?? [];
  return Promise.all((data ?? []).map((i) => refreshInvoice(svc, i)));
}

export type PayChannel = "mobile_money" | "card" | "bank_transfer";
export interface PayInvoiceArgs {
  channel: PayChannel;
  momo?: { phone: string; provider: "mtn" | "vod" | "atl" } | null;
  /** Pay just one insurer's lines (the statement can be settled insurer by insurer). */
  insurerOrgId?: string | null;
  callbackUrl?: string;
}
export interface PayLineResult {
  insurerOrgId: string;
  insurerName: string | null;
  description: string;
  amount: number;
  status: string;
  paymentId: string | null;
  reference: string | null;
  authorizationUrl: string | null;
  message: string | null;
}

/**
 * Pay a statement: one payment per insurer line through the existing checkout (`initiatePayment` for new business,
 * the insurer's instalment schedule for instalments). Each payment settles to that insurer — never pooled at Covva.
 * Owners, admins and finance may pay. Lines already paid (or in flight) are skipped.
 */
export async function payInvoice(ctx: BusinessCtx, invoiceId: string, args: PayInvoiceArgs): Promise<{ invoiceId: string; results: PayLineResult[] }> {
  assertUuid(invoiceId, "Statement");
  const { data: inv } = await db(ctx.supabase).from("business_invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) throw new BusinessRuleError("Statement not found.", "not_found");
  await requireBusinessRole(ctx, inv.business_org_id, "billing");
  if (inv.status === "paid") throw new BusinessRuleError("This statement is already paid.", "conflict");
  const svc = requireSvc();
  const lines = invoiceLines(inv);
  const targets = lines.filter((l) => (!args.insurerOrgId || l.insurer_org_id === args.insurerOrgId) && l.payment_status !== "succeeded");
  if (!targets.length) throw new BusinessRuleError(args.insurerOrgId ? "Nothing is due to that insurer on this statement." : "Nothing is left to pay on this statement.", "conflict");
  const inst = await instalmentsModule();
  const results: PayLineResult[] = [];
  const updated = new Map<string, InvoiceLineDb>();
  for (const line of targets) {
    const base = { insurerOrgId: line.insurer_org_id, insurerName: line.insurer_name, description: line.description, amount: line.amount };
    try {
      if (line.application_id) {
        // The application belongs to the business's request; the payer of record is the account holder who asked for the quote.
        const { data: app } = await svc.from("applications").select("id, customer_id, request_id").eq("id", line.application_id).maybeSingle();
        const { data: req } = app ? await svc.from("requests").select("business_org_id").eq("id", app.request_id).maybeSingle() : { data: null };
        if (!app || req?.business_org_id !== inv.business_org_id) throw new BusinessRuleError("This item no longer belongs to the business.", "not_found");
        const r = await initiatePayment({ applicationId: app.id, channel: args.channel, momo: args.momo ?? undefined, userId: app.customer_id, callbackUrl: args.callbackUrl });
        results.push({ ...base, status: r.status, paymentId: r.paymentId, reference: r.reference, authorizationUrl: r.authorizationUrl, message: r.displayText ?? r.bankTransfer?.instructions ?? null });
        updated.set(lineKey(line), { ...line, payment_id: r.paymentId, payment_status: r.status });
      } else if (line.instalment_id && inst) {
        const { data: pol } = line.policy_id ? await svc.from("policies").select("customer_id").eq("id", line.policy_id).maybeSingle() : { data: null };
        if (args.channel === "bank_transfer") throw new BusinessRuleError("Instalments are collected by mobile money or card.");
        const r = await inst.payInstalment(line.instalment_id, pol?.customer_id ?? null, { channel: args.channel, momo: args.momo ? { phone: args.momo.phone, network: args.momo.provider } : null, callbackUrl: args.callbackUrl });
        results.push({ ...base, status: r.status, paymentId: r.paymentId, reference: r.reference, authorizationUrl: r.authorizationUrl, message: r.displayText });
        if (r.paymentId) updated.set(lineKey(line), { ...line, payment_id: r.paymentId, payment_status: r.status });
      } else {
        results.push({ ...base, status: "not_collected", paymentId: null, reference: null, authorizationUrl: null, message: `${line.insurer_name ?? "The insurer"} collects this premium directly (debit order or invoice). Your broker can send the insurer's payment details.` });
      }
    } catch (err) {
      results.push({ ...base, status: "failed", paymentId: null, reference: null, authorizationUrl: null, message: err instanceof BusinessRuleError ? err.message : "We couldn't start this payment. Please try again." });
      if (!(err instanceof BusinessRuleError)) log.warn("business.pay_line_failed", { invoiceId, err });
    }
  }
  if (updated.size) {
    const next = lines.map((l) => updated.get(lineKey(l)) ?? l);
    await db(svc).from("business_invoices").update({ lines: next as unknown as Json }).eq("id", invoiceId);
  }
  log.info("business.invoice_pay", { invoiceId, lines: results.length });
  return { invoiceId, results };
}

// ---------------------------------------------------------------------------
// Member self-service
// ---------------------------------------------------------------------------
/** Link scheme memberships to the caller's account by their verified sign-in phone. Returns rows linked. */
export async function linkSchemeMemberships(supabase: UserClient): Promise<number> {
  const { data, error } = await db(supabase).rpc("link_my_scheme_memberships");
  if (error) {
    log.warn("business.link_failed", { err: error });
    return 0;
  }
  return Number(data ?? 0);
}

export interface MyWorkplaceCover {
  memberId: string;
  schemeId: string;
  schemeName: string;
  businessName: string;
  categoryName: string;
  relationship: string;
  coverTier: string | null;
  status: string;
  schemeStatus: string;
  insurerName: string | null;
  renewalDate: string | null;
}

/** The caller's own cover as a scheme member (linked rows only). */
export async function myWorkplaceCover(ctx: BusinessCtx): Promise<MyWorkplaceCover[]> {
  const { data: rows } = await db(ctx.supabase).from("scheme_members").select("id, scheme_id, relationship, cover_tier, status").eq("user_id", ctx.userId).neq("status", "removed");
  if (!rows?.length) return [];
  const { data: schemes } = await db(ctx.supabase).from("group_schemes").select("id, name, business_org_id, category_id, status, insurer_org_id, renewal_date").in("id", rows.map((r) => r.scheme_id));
  const svc = svcOrNull();
  const orgIds = [...new Set((schemes ?? []).flatMap((s) => [s.business_org_id, s.insurer_org_id]).filter((x): x is string => !!x))];
  const { data: orgs } = svc && orgIds.length ? await svc.from("organizations").select("id, name").in("id", orgIds) : { data: [] as { id: string; name: string }[] };
  const name = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const cats = await categoryMap(ctx.supabase);
  const sm = new Map((schemes ?? []).map((s) => [s.id, s]));
  return rows.flatMap((r) => {
    const s = sm.get(r.scheme_id);
    if (!s) return [];
    return [{ memberId: r.id, schemeId: s.id, schemeName: s.name, businessName: name.get(s.business_org_id) ?? "Your employer", categoryName: cats.get(s.category_id)?.name ?? "Group cover", relationship: r.relationship, coverTier: r.cover_tier, status: r.status, schemeStatus: s.status, insurerName: s.insurer_org_id ? name.get(s.insurer_org_id) ?? null : null, renewalDate: s.renewal_date }];
  });
}

/** Tell a member their employer added them (best effort; used after a single add when the member has an account). */
export async function notifyMemberAdded(userId: string, schemeName: string, businessName: string): Promise<void> {
  await notify({ userId, kind: "business.member.added", title: `${businessName} added you to ${schemeName}`, body: "Your workplace cover now shows in your Covva account.", link: "/account/business", channels: ["in_app", "push"] }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Broker / insurer views (RLS decides what the partner sees; names via the service client for those rows only)
// ---------------------------------------------------------------------------
export interface PartnerScheme extends GroupSchemeRow {
  categoryName: string;
  census: CensusSummary;
  members: SchemeMemberRow[];
}
export interface PartnerBusinessClient {
  orgId: string;
  name: string;
  industry: string | null;
  schemes: PartnerScheme[];
  fleet: FleetVehicleRow[];
  requests: { id: string; reference: string; title: string | null; status: string; created_at: string }[];
}

/** Businesses the broker (or insurer) services: their schemes with census + member list, fleets and requests. */
export async function partnerBusinessClients(supabase: UserClient, partnerOrgId: string): Promise<PartnerBusinessClient[]> {
  const sdb = db(supabase);
  const [{ data: schemes }, { data: reqs }] = await Promise.all([
    sdb.from("group_schemes").select("*").or(`broker_org_id.eq.${partnerOrgId},insurer_org_id.eq.${partnerOrgId}`).order("created_at", { ascending: false }).limit(500),
    supabase.from("requests").select("id, reference, title, status, created_at, business_org_id").eq("broker_org_id", partnerOrgId).not("business_org_id", "is", null).order("created_at", { ascending: false }).limit(500),
  ]);
  const orgIds = [...new Set([...(schemes ?? []).map((s) => s.business_org_id), ...(reqs ?? []).map((r) => r.business_org_id!).filter(Boolean)])];
  if (!orgIds.length) return [];
  const schemeIds = (schemes ?? []).map((s) => s.id);
  const [{ data: members }, { data: fleet }, cats] = await Promise.all([
    schemeIds.length ? sdb.from("scheme_members").select("*").in("scheme_id", schemeIds).neq("status", "removed").order("full_name").limit(20000) : Promise.resolve({ data: [] as SchemeMemberRow[] }),
    sdb.from("fleet_vehicles").select("*").in("business_org_id", orgIds).eq("status", "active").order("registration").limit(20000),
    categoryMap(supabase),
  ]);
  const svc = svcOrNull();
  const { data: orgs } = svc ? await db(svc).from("organizations").select("id, name, business_profile").in("id", orgIds).eq("type", "enterprise") : { data: [] as { id: string; name: string; business_profile: Json }[] };
  return orgIds.map((orgId) => {
    const o = (orgs ?? []).find((x) => x.id === orgId);
    const profile = (o?.business_profile ?? {}) as BusinessProfile;
    return {
      orgId,
      name: o?.name ?? "Business client",
      industry: profile.industry ?? null,
      schemes: (schemes ?? []).filter((s) => s.business_org_id === orgId).map((s) => {
        const ms = (members ?? []).filter((m) => m.scheme_id === s.id);
        return { ...s, categoryName: cats.get(s.category_id)?.name ?? "Group cover", census: censusSummary(ms), members: ms };
      }),
      fleet: (fleet ?? []).filter((v) => v.business_org_id === orgId),
      requests: (reqs ?? []).filter((r) => r.business_org_id === orgId).map((r) => ({ id: r.id, reference: r.reference, title: r.title, status: r.status, created_at: r.created_at })),
    };
  });
}

/** Scheme + members behind a request (insurer issuance view). Null when the request is not a group scheme or RLS hides it. */
export async function schemeForRequest(supabase: UserClient, requestId: string): Promise<{ scheme: GroupSchemeRow; census: CensusSummary; members: SchemeMemberRow[] } | null> {
  if (!UUID.test(requestId)) return null;
  const sdb = db(supabase);
  const { data: scheme } = await sdb.from("group_schemes").select("*").eq("request_id", requestId).maybeSingle();
  if (!scheme) return null;
  const { data: members } = await sdb.from("scheme_members").select("*").eq("scheme_id", scheme.id).neq("status", "removed").order("relationship").order("full_name").limit(20000);
  return { scheme, census: censusSummary(members ?? []), members: members ?? [] };
}
