import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessMessage, parseActiveWorkspace, workspaceAccess, type ApiKeyScope, type ClientKind } from "@im/core";
import type { Database, Enum } from "@im/db";
import { ApiError, forbidden, hasScopes, notFound, siteUrl, type ApiKeyAuth, type UserAuth } from "@/server/api-auth";

/**
 * Broker workspace on mobile (Addendum 4 §2): shared plumbing for `/api/v1/partner/*` endpoints
 * that work both for signed-in partner users (bearer / cookie, RLS applies) and partner API keys
 * (service client, scoped to the key's organisation in code).
 */
export type PartnerKind = Extract<Enum<"org_type">, "broker" | "insurer">;
export type MemberRole = Enum<"member_role">;

export const ORG_HEADER = "x-covva-org";

/** Roles mirroring `apps/web/src/app/(partner)/partner/_lib/context.ts` ROLES (kept local: that file is Server-Component only). */
export const PARTNER_ROLES = {
  brokerWork: ["owner", "admin", "supervisor", "adviser"] as MemberRole[],
  claims: ["owner", "admin", "claims_officer", "supervisor", "adviser"] as MemberRole[],
  orgAdmin: ["owner", "admin"] as MemberRole[],
  billing: ["owner", "admin", "finance"] as MemberRole[],
};

export interface PartnerPrincipal {
  /** RLS client for users; service client for API keys (always filter by `orgId`). */
  db: SupabaseClient<Database>;
  orgId: string;
  orgType: PartnerKind;
  orgName: string;
  /** Null for API keys. */
  userId: string | null;
  role: MemberRole | null;
  isSupervisor: boolean;
  viaApiKey: boolean;
  /** All partner workspaces of the user (so the app can offer a switcher). */
  workspaces: { orgId: string; orgName: string; type: PartnerKind; role: MemberRole }[];
}

type MembershipRow = { id: string; org_id: string; role: MemberRole; is_supervisor: boolean; org: { id: string; name: string; type: Enum<"org_type">; status: Enum<"org_status"> } | null };

/**
 * Work out which organisation a `/partner/*` call is for and check the caller may use it from this
 * client. Order for users: `?orgId=` → `X-Covva-Org` header → `profiles.active_workspace` → the only
 * partner membership → the first broker membership (mobile) / first membership (web).
 */
export async function resolvePartnerOrg(
  auth: UserAuth | ApiKeyAuth,
  req: NextRequest,
  client: ClientKind,
  opts: { kinds?: PartnerKind[]; roles?: MemberRole[]; orgId?: string } = {},
): Promise<PartnerPrincipal> {
  if (auth.kind === "apiKey") {
    if (opts.kinds && !opts.kinds.includes(auth.orgType)) throw forbidden(`This endpoint is for ${opts.kinds.join(" or ")} organisations.`);
    return { db: auth.svc, orgId: auth.orgId, orgType: auth.orgType, orgName: auth.orgName, userId: null, role: null, isSupervisor: false, viaApiKey: true, workspaces: [] };
  }
  const { data } = await auth.supabase
    .from("memberships")
    .select("id, org_id, role, is_supervisor, org:organizations!memberships_org_id_fkey(id, name, type, status)")
    .eq("user_id", auth.userId)
    .eq("active", true);
  const partner = ((data ?? []) as unknown as MembershipRow[]).filter((m) => m.org && (m.org.type === "broker" || m.org.type === "insurer") && m.org.status !== "offboarded");
  if (!partner.length) throw forbidden("This account has no broker or insurer workspace.");

  const wanted = opts.orgId ?? req.nextUrl.searchParams.get("orgId") ?? req.headers.get(ORG_HEADER) ?? undefined;
  let chosen: MembershipRow | undefined;
  if (wanted) {
    chosen = partner.find((m) => m.org_id === wanted);
    if (!chosen) throw forbidden("You don't belong to that organisation.");
  } else {
    const { data: profile } = await auth.supabase.from("profiles").select("active_workspace").eq("id", auth.userId).maybeSingle();
    const active = parseActiveWorkspace(profile?.active_workspace);
    if (active?.orgId) chosen = partner.find((m) => m.org_id === active.orgId);
    chosen ??= partner.length === 1 ? partner[0] : (client === "mobile" ? partner.find((m) => m.org!.type === "broker") : undefined) ?? partner[0];
  }
  const org = chosen!.org!;
  const type = org.type as PartnerKind;
  const access = workspaceAccess(type, client);
  if (!access.allowed) {
    throw new ApiError("forbidden", accessMessage(access, siteUrl()) ?? "That workspace isn't available on this client.", { reason: access.reason, portalUrl: `${siteUrl()}/partner` });
  }
  if (opts.kinds && !opts.kinds.includes(type)) throw forbidden(`This endpoint is for ${opts.kinds.join(" or ")} organisations.`);
  const isSupervisor = chosen!.is_supervisor || ["owner", "admin", "supervisor"].includes(chosen!.role);
  if (opts.roles && !opts.roles.includes(chosen!.role) && !(opts.roles.includes("supervisor") && isSupervisor)) {
    throw forbidden("Your role does not allow this. Ask an organisation admin.");
  }
  return {
    db: auth.supabase as unknown as SupabaseClient<Database>,
    orgId: org.id,
    orgType: type,
    orgName: org.name,
    userId: auth.userId,
    role: chosen!.role,
    isSupervisor,
    viaApiKey: false,
    workspaces: partner.map((m) => ({ orgId: m.org_id, orgName: m.org!.name, type: m.org!.type as PartnerKind, role: m.role })),
  };
}

/** Money is visible to owners/admins/finance (users) or keys with `finance:read` (same rule as the ledger RLS). */
export function canSeeMoney(auth: UserAuth | ApiKeyAuth, p: PartnerPrincipal): boolean {
  if (auth.kind === "apiKey") return hasScopes(auth, ["finance:read" as ApiKeyScope]);
  return !!p.role && PARTNER_ROLES.billing.includes(p.role);
}

/** Throw unless the principal holds one of the roles (API keys pass: the key is an org-level credential). */
export function requireRole(p: PartnerPrincipal, roles: MemberRole[], message = "Your role does not allow this."): void {
  if (p.viaApiKey) return;
  if (p.role && roles.includes(p.role)) return;
  if (p.isSupervisor && roles.includes("supervisor")) return;
  throw forbidden(message);
}

// ---------------------------------------------------------------------------
// Customers (broker's clients)
// ---------------------------------------------------------------------------
export type CustomerProfile = { id: string; full_name: string | null; preferred_name: string | null; email: string | null; phone: string | null; account_type: Enum<"account_type">; business_name: string | null; kyc_status: Enum<"kyc_status">; region: string | null; city: string | null; created_at: string };

export function displayName(p: Pick<CustomerProfile, "full_name" | "preferred_name" | "business_name" | "email"> | null | undefined): string {
  if (!p) return "Customer";
  return p.business_name || p.full_name?.trim() || p.preferred_name || p.email || "Customer";
}

export interface ClientSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountType: Enum<"account_type">;
  businessName: string | null;
  kycStatus: Enum<"kyc_status">;
  region: string | null;
  city: string | null;
  source: "assignment" | "request" | "policy";
  assignedSince: string | null;
  openRequests: number;
  activePolicies: number;
  lastRequestAt: string | null;
}

/**
 * The broker's clients: active `customer_broker_assignments` plus customers whose requests or
 * policies name the organisation as broker of record. Profiles come through RLS (`can_view_customer`).
 */
export async function listBrokerClients(p: PartnerPrincipal, opts: { q?: string; limit: number; offset: number }): Promise<{ items: ClientSummary[]; total: number }> {
  const [assignments, requests, policies] = await Promise.all([
    p.db.from("customer_broker_assignments").select("customer_id, created_at, source").eq("broker_org_id", p.orgId).eq("active", true).limit(5000),
    p.db.from("requests").select("customer_id, status, created_at").eq("broker_org_id", p.orgId).neq("status", "draft").order("created_at", { ascending: false }).limit(5000),
    p.db.from("policies").select("customer_id, status").eq("broker_org_id", p.orgId).limit(5000),
  ]);
  type Acc = { source: ClientSummary["source"]; assignedSince: string | null; open: number; active: number; last: string | null };
  const acc = new Map<string, Acc>();
  const get = (id: string, source: ClientSummary["source"]) => {
    let a = acc.get(id);
    if (!a) {
      a = { source, assignedSince: null, open: 0, active: 0, last: null };
      acc.set(id, a);
    }
    return a;
  };
  for (const a of assignments.data ?? []) {
    const x = get(a.customer_id, "assignment");
    x.source = "assignment";
    x.assignedSince = a.created_at;
  }
  const OPEN = new Set(["submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready", "payment_confirmation", "policy_documents"]);
  for (const r of requests.data ?? []) {
    const x = get(r.customer_id, "request");
    if (OPEN.has(r.status)) x.open++;
    if (!x.last || r.created_at > x.last) x.last = r.created_at;
  }
  for (const pol of policies.data ?? []) {
    const x = get(pol.customer_id, "policy");
    if (pol.status === "active") x.active++;
  }
  const ids = [...acc.keys()];
  if (!ids.length) return { items: [], total: 0 };
  const profiles = new Map<string, CustomerProfile>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await p.db.from("profiles").select("id, full_name, preferred_name, email, phone, account_type, business_name, kyc_status, region, city, created_at").in("id", ids.slice(i, i + 500));
    for (const row of data ?? []) profiles.set(row.id, row as CustomerProfile);
  }
  let items: ClientSummary[] = ids.map((id) => {
    const a = acc.get(id)!;
    const pr = profiles.get(id);
    return {
      id,
      name: displayName(pr),
      email: pr?.email ?? null,
      phone: pr?.phone ?? null,
      accountType: pr?.account_type ?? "individual",
      businessName: pr?.business_name ?? null,
      kycStatus: pr?.kyc_status ?? "unverified",
      region: pr?.region ?? null,
      city: pr?.city ?? null,
      source: a.source,
      assignedSince: a.assignedSince,
      openRequests: a.open,
      activePolicies: a.active,
      lastRequestAt: a.last,
    };
  });
  const q = opts.q?.trim().toLowerCase();
  if (q) items = items.filter((c) => [c.name, c.email, c.phone, c.businessName].some((v) => v?.toLowerCase().includes(q)));
  items.sort((a, b) => (b.lastRequestAt ?? b.assignedSince ?? "").localeCompare(a.lastRequestAt ?? a.assignedSince ?? "") || a.name.localeCompare(b.name));
  return { items: items.slice(opts.offset, opts.offset + opts.limit), total: items.length };
}

/** One client with their policies, requests, claims and assignment history (all RLS-scoped). */
export async function brokerClient(p: PartnerPrincipal, customerId: string) {
  const [{ data: profile }, policies, requests, claims, assignments] = await Promise.all([
    p.db.from("profiles").select("id, full_name, preferred_name, email, phone, account_type, business_name, kyc_status, region, city, created_at").eq("id", customerId).maybeSingle(),
    p.db.from("policies").select("id, internal_reference, policy_number, status, premium, currency, cover_start, cover_end, nickname, source, category:product_categories(slug, name)").eq("customer_id", customerId).eq("broker_org_id", p.orgId).order("cover_end", { ascending: false, nullsFirst: false }).limit(200),
    p.db.from("requests").select("id, reference, status, type, title, due_at, next_step, created_at, updated_at, category:product_categories(slug, name)").eq("customer_id", customerId).eq("broker_org_id", p.orgId).neq("status", "draft").order("created_at", { ascending: false }).limit(200),
    p.db.from("claims").select("id, reference, status, incident_type, incident_at, amount_claimed, decision_amount, created_at").eq("customer_id", customerId).eq("broker_org_id", p.orgId).order("created_at", { ascending: false }).limit(100),
    p.db.from("customer_broker_assignments").select("id, source, active, created_at, ended_at, note").eq("customer_id", customerId).eq("broker_org_id", p.orgId).order("created_at", { ascending: false }).limit(20),
  ]);
  const hasRelation = (policies.data?.length ?? 0) + (requests.data?.length ?? 0) + (assignments.data?.length ?? 0) > 0;
  if (!profile || !hasRelation) throw notFound("Customer not found.");
  return {
    customer: { ...profile, name: displayName(profile) },
    policies: policies.data ?? [],
    requests: requests.data ?? [],
    claims: claims.data ?? [],
    assignments: assignments.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Uploads from the phone camera
// ---------------------------------------------------------------------------
/** Decode a base64 string (plain or `data:` URL) into bytes; throws `invalid_input` on garbage. */
export function decodeBase64(content: string): Uint8Array {
  const raw = content.includes(",") && content.trimStart().startsWith("data:") ? content.slice(content.indexOf(",") + 1) : content;
  const cleaned = raw.replace(/\s+/g, "");
  if (!cleaned || !/^[A-Za-z0-9+/=_-]+$/.test(cleaned)) throw new ApiError("invalid_input", "The file contents must be base64-encoded.");
  const buf = Buffer.from(cleaned.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (!buf.length) throw new ApiError("invalid_input", "The file is empty.");
  return new Uint8Array(buf);
}

export function scopeFor(links: { requestId?: string; policyId?: string; claimId?: string }): "requests" | "policies" | "claims" {
  if (links.claimId) return "claims";
  if (links.policyId) return "policies";
  return "requests";
}
