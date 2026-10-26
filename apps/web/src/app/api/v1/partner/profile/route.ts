import { UpdatePartnerProfileInput, roleLabel } from "@im/core";
import type { Update } from "@im/db";
import { check, must, parseJson, withApi } from "@/server/api-auth";
import { PARTNER_ROLES, requireRole, resolvePartnerOrg } from "@/server/partner-mobile";

const ORG_FIELDS = "id, name, slug, type, status, legal_name, description, logo_url, brand_color, website, contact_email, contact_phone, address, region, registration_number, nic_licence_number, nic_licence_class, nic_licence_expires_on, licence_verified_at, professional_indemnity_expires_on, integration_level, require_mfa, created_at";

/**
 * GET /api/v1/partner/profile — the organisation profile, the caller's role, the team size and the
 * organisation's insurer/broker links (`insurer_broker_appointments`, per product line).
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const p = await resolvePartnerOrg(auth, req, client);
    const [org, appointments, members] = await Promise.all([
      must(await p.db.from("organizations").select(ORG_FIELDS).eq("id", p.orgId).maybeSingle(), "Organisation not found."),
      p.db
        .from("insurer_broker_appointments")
        .select("id, insurer_org_id, broker_org_id, category_id, active, agreement_reference, starts_on, ends_on, created_at, insurer:organizations!insurer_broker_appointments_insurer_org_id_fkey(id, name, slug, logo_url), broker:organizations!insurer_broker_appointments_broker_org_id_fkey(id, name, slug, logo_url), category:product_categories(slug, name)")
        .eq(p.orgType === "broker" ? "broker_org_id" : "insurer_org_id", p.orgId)
        .order("created_at", { ascending: false })
        .limit(200),
      p.db.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", p.orgId).eq("active", true),
    ]);
    check(appointments);
    const links = (appointments.data ?? []).map((a) => {
      const other = (p.orgType === "broker" ? a.insurer : a.broker) as unknown as { id: string; name: string; slug: string; logo_url: string | null } | null;
      return { id: a.id, active: a.active, organisation: other, category: a.category, agreementReference: a.agreement_reference, startsOn: a.starts_on, endsOn: a.ends_on };
    });
    return {
      organisation: org,
      membership: p.role ? { role: p.role, roleLabel: roleLabel(p.orgType, p.role), isSupervisor: p.isSupervisor, canEditProfile: PARTNER_ROLES.orgAdmin.includes(p.role) } : null,
      teamSize: members.count ?? 0,
      links: { kind: p.orgType === "broker" ? "insurers" : "brokers", active: links.filter((l) => l.active).length, items: links },
      workspaces: p.workspaces,
    };
  },
  { auth: "either" },
);

/** PATCH /api/v1/partner/profile — contact details only (owners and admins). Licence and legal names change through registration or Covva admin. */
export const PATCH = withApi(
  async ({ auth, req, client }) => {
    const input = await parseJson(req, UpdatePartnerProfileInput);
    const p = await resolvePartnerOrg(auth, req, client);
    requireRole(p, PARTNER_ROLES.orgAdmin, "Only owners and admins can change the organisation profile.");
    const patch: Update<"organizations"> = {};
    if (input.contactEmail !== undefined) patch.contact_email = input.contactEmail?.toLowerCase() ?? null;
    if (input.contactPhone !== undefined) patch.contact_phone = input.contactPhone;
    if (input.website !== undefined) patch.website = input.website;
    if (input.address !== undefined) patch.address = input.address;
    if (input.region !== undefined) patch.region = input.region;
    if (input.description !== undefined) patch.description = input.description;
    const res = await p.db.from("organizations").update(patch).eq("id", p.orgId).select(ORG_FIELDS).single();
    check(res);
    return { organisation: res.data };
  },
  { auth: "either" },
);
