"use server";
import { z } from "zod";
import { PARTNER_SEGMENTS, normaliseWidgetDomain, referralCode } from "@im/core";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

const Profile = z.object({
  segment: z.enum(PARTNER_SEGMENTS),
  categories: z.unknown().transform(list),
  domains: z.string().optional().transform((v) => (v ?? "").split(/[\s,]+/).filter(Boolean)),
  revenue_share_pct: z.coerce.number().min(0, "Revenue share cannot be negative").max(100, "At most 100% of Covva's platform fee"),
  status: z.enum(["pending", "active", "suspended"]),
  contract_ref: z.string().trim().max(100).optional().transform((v) => (v ? v : null)),
});

function cleanDomains(raw: string[]): { ok: true; domains: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  for (const d of raw) {
    const n = normaliseWidgetDomain(d);
    if (!n) return { ok: false, error: `“${d}” is not a valid https origin.` };
    if (!out.includes(n)) out.push(n);
  }
  return { ok: true, domains: out };
}

const Create = Profile.extend({
  source: z.enum(["crm", "org", "new"]),
  crm_account_id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  org_id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().max(200).optional(),
});

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "partner";
}

/**
 * Create a distribution partner from a CRM embedded-partner account, an existing distributor
 * organisation or a new organisation. Also links the CRM account and issues the widget code.
 */
export async function createDistributionPartner(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("distribution");
  if (!auth.ok) return fail(auth.error);
  const parsed = Create.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const v = parsed.data;
  const domains = cleanDomains(v.domains);
  if (!domains.ok) return fail(domains.error);
  const sb = auth.supabase;

  let orgId: string | null = null;
  let crmAccountId: string | null = null;
  let name = v.name ?? "";
  if (v.source === "crm") {
    if (!v.crm_account_id) return fail("Choose a CRM account.");
    const { data: acc } = await sb.from("crm_accounts").select("id, name, org_id, kind").eq("id", v.crm_account_id).maybeSingle();
    if (!acc) return fail("CRM account not found.");
    crmAccountId = acc.id;
    name = acc.name;
    orgId = acc.org_id;
  } else if (v.source === "org") {
    if (!v.org_id) return fail("Choose an organisation.");
    orgId = v.org_id;
  } else if (name.trim().length < 2) {
    return fail("Name the new organisation.");
  }

  if (orgId) {
    const { data: org } = await sb.from("organizations").select("type").eq("id", orgId).maybeSingle();
    if (!org) return fail("Organisation not found.");
    if (org.type !== "distributor") return fail("That organisation is not a distributor (brokers and insurers cannot be distribution partners).");
  } else {
    let slug = slugify(name);
    const { data: clash } = await sb.from("organizations").select("id").eq("slug", slug).maybeSingle();
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: org, error } = await sb.from("organizations").insert({ name: name.trim(), slug, type: "distributor", status: v.status === "active" ? "active" : "pending", settings: {} }).select("id").single();
    if (error) return fail(dbMessage(error));
    orgId = org.id;
    if (crmAccountId) await sb.from("crm_accounts").update({ org_id: orgId }).eq("id", crmAccountId).is("org_id", null);
  }

  const { error } = await sb.from("distribution_partners").insert({
    org_id: orgId,
    crm_account_id: crmAccountId,
    segment: v.segment,
    allowed_categories: v.categories,
    widget_domains: domains.domains,
    revenue_share_pct: v.revenue_share_pct,
    status: v.status,
    contract_ref: v.contract_ref,
    created_by: auth.staff.userId,
  });
  if (error) return fail(dbMessage(error));
  if (v.status === "active") await sb.from("organizations").update({ status: "active" }).eq("id", orgId).eq("status", "pending");
  const { error: linkErr } = await sb.rpc("create_partner_referral_link", { p_org_id: orgId, p_campaign: "widget", p_landing_path: "/", p_code: referralCode() });
  return done(linkErr ? `Partner created, but the widget code failed: ${dbMessage(linkErr)}` : "Distribution partner created with its widget code. Invite their team from the organisation page.");
}

const Update = Profile.extend({ partnerId: z.string().uuid() });

export async function updateDistributionPartner(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("distribution");
  if (!auth.ok) return fail(auth.error);
  const parsed = Update.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { partnerId, domains: raw, categories, ...v } = parsed.data;
  const domains = cleanDomains(raw);
  if (!domains.ok) return fail(domains.error);
  const { data: row, error } = await auth.supabase
    .from("distribution_partners")
    .update({ ...v, allowed_categories: categories, widget_domains: domains.domains })
    .eq("id", partnerId)
    .select("org_id")
    .single();
  if (error) return fail(dbMessage(error));
  // Distributors need no NIC licence: activating the partnership activates a pending organisation.
  if (v.status === "active") await auth.supabase.from("organizations").update({ status: "active" }).eq("id", row.org_id).eq("status", "pending");
  return done("Partner saved. Widget changes reach live embeds within five minutes.");
}
