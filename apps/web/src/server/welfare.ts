import "server-only";
import {
  CONTRIBUTION_STATUS,
  WELFARE_CONSENT_TEXT,
  allocateSponsorPayment,
  formatMoney,
  funeralClaimChecklist,
  groupContributionSummary,
  memberStanding,
  parseDisplayCurrency,
  parseWelfareMemberCsv,
  welfareIncidentType,
  welfareJoinPath,
  welfareSponsorPath,
  type ContributionLike,
  type GroupContributionSummary,
  type MemberStanding,
  type WelfareClaimKind,
  type WelfareMemberImportRow,
} from "@im/core";
import type { Enum, Json, Row } from "@im/db";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { BusinessRuleError, createRequest, ruleMessage } from "@/server/requests";
import { createClaim, type ClaimEvidenceFile } from "@/server/claims";
import { initiatePolicyCollection, type PaymentOutcome } from "@/server/payments";
import { recordPaymentLedger } from "@/server/ledger";
import { notify, notifyOrg } from "@/server/notify";
import { log } from "@/server/log";

/**
 * Funeral cover & welfare groups (Roadmap Phase 4). Reads go through the caller's RLS client (members see their
 * group, admins manage it, sponsors see the members they pay for, the broker of record / insurer see the group,
 * staff see all). Writes that cross users — contributions, payments, claims on the master policy — use the
 * service client after the checks below. Money never touches a Covva account: every contribution is a premium
 * payment on the group's master policy that settles to the insurer (broker commission by split).
 */
type UserClient = Awaited<ReturnType<typeof createClient>>;
type Svc = ReturnType<typeof createServiceClient>;
export interface WelfareCtx { supabase: UserClient; userId: string }

export type WelfareGroup = Row<"welfare_groups">;
export type WelfareMember = Row<"welfare_members">;
export type WelfareBeneficiary = Row<"welfare_beneficiaries">;
export type WelfareSponsor = Row<"welfare_sponsors">;
export type WelfareContribution = Row<"welfare_contributions">;
export type OrgLite = Pick<Row<"organizations">, "id" | "name" | "slug" | "type" | "nic_licence_number" | "logo_url" | "brand_color">;
const ORG_COLS = "id, name, slug, type, nic_licence_number, logo_url, brand_color";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function fail(err: { code?: string; message?: string } | null | undefined, fallback: string): never {
  if (err?.code === "42501") throw new BusinessRuleError("You don't have access to this group.", "forbidden");
  if (err?.code === "23505") throw new BusinessRuleError("This already exists.", "conflict");
  throw new BusinessRuleError(ruleMessage(err, fallback), err?.code === "P0001" ? "business_rule" : "internal");
}
function assertUuid(id: string, what: string) {
  if (!UUID.test(id)) throw new BusinessRuleError(`${what} not found.`, "not_found");
}

// ---------------------------------------------------------------------------
// Lists and detail
// ---------------------------------------------------------------------------
export interface MyWelfareGroups {
  /** Groups the caller admins (creator or admin-role member). */
  admin: WelfareGroup[];
  /** Groups the caller belongs to as a member (own row attached). */
  member: { group: WelfareGroup; me: WelfareMember }[];
  /** Members the caller pays for as a sponsor abroad. */
  sponsored: { group: WelfareGroup; member: WelfareMember; sponsorship: WelfareSponsor; standing: MemberStanding; unpaidGhs: number }[];
  /** Invitations by e-mail waiting for the caller (linked by `link_my_welfare_memberships`). */
  pendingConsent: { group: WelfareGroup; me: WelfareMember }[];
}

export async function myWelfareGroups(ctx: WelfareCtx): Promise<MyWelfareGroups> {
  // Verified phone / e-mail matches made while the user was away (idempotent, cheap).
  await ctx.supabase.rpc("link_my_welfare_memberships").then(() => undefined, () => undefined);
  const [{ data: groups }, { data: mine }, { data: sponsorships }] = await Promise.all([
    ctx.supabase.from("welfare_groups").select("*").order("created_at", { ascending: false }).limit(200),
    ctx.supabase.from("welfare_members").select("*").eq("user_id", ctx.userId).neq("status", "left"),
    ctx.supabase.from("welfare_sponsors").select("*").eq("sponsor_user_id", ctx.userId).eq("status", "active"),
  ]);
  const byId = new Map((groups ?? []).map((g) => [g.id, g]));
  const admin = (groups ?? []).filter((g) => g.admin_user_id === ctx.userId || (mine ?? []).some((m) => m.group_id === g.id && m.role === "admin" && m.status === "active"));
  const member = (mine ?? []).filter((m) => byId.has(m.group_id) && !admin.some((g) => g.id === m.group_id)).map((m) => ({ group: byId.get(m.group_id)!, me: m }));
  const pendingConsent = (mine ?? []).filter((m) => byId.has(m.group_id) && m.consent_at === null).map((m) => ({ group: byId.get(m.group_id)!, me: m }));
  const sponsored: MyWelfareGroups["sponsored"] = [];
  if (sponsorships?.length) {
    const memberIds = sponsorships.map((s) => s.member_id);
    const [{ data: members }, { data: contributions }] = await Promise.all([
      ctx.supabase.from("welfare_members").select("*").in("id", memberIds),
      ctx.supabase.from("welfare_contributions").select("*").in("member_id", memberIds).order("period_start"),
    ]);
    for (const s of sponsorships) {
      const m = members?.find((x) => x.id === s.member_id);
      const g = byId.get(s.group_id);
      if (!m || !g) continue;
      const standing = memberStanding(m.id, (contributions ?? []) as ContributionLike[]);
      const unpaid = (contributions ?? []).filter((c) => c.member_id === m.id && (c.status === "due" || c.status === "failed")).reduce((t, c) => t + Number(c.amount), 0);
      sponsored.push({ group: g, member: m, sponsorship: s, standing, unpaidGhs: Math.round(unpaid * 100) / 100 });
    }
  }
  return { admin, member, sponsored, pendingConsent };
}

export type WelfareRole = "admin" | "member" | "sponsor" | "partner" | "staff";

export interface WelfareGroupDetail {
  group: WelfareGroup;
  roles: WelfareRole[];
  isAdmin: boolean;
  me: WelfareMember | null;
  members: WelfareMember[];
  beneficiaries: WelfareBeneficiary[];
  sponsors: WelfareSponsor[];
  contributions: WelfareContribution[];
  summary: GroupContributionSummary;
  standings: Record<string, MemberStanding>;
  broker: OrgLite | null;
  insurer: OrgLite | null;
  policy: Pick<Row<"policies">, "id" | "policy_number" | "internal_reference" | "status" | "cover_start" | "cover_end" | "premium" | "billing_period" | "customer_id"> | null;
  request: Pick<Row<"requests">, "id" | "reference" | "status" | "next_step"> | null;
  claims: Pick<Row<"claims">, "id" | "reference" | "status" | "incident_type" | "welfare_member_id" | "created_at">[];
  joinUrl: string | null;
}

export async function welfareGroupDetail(ctx: WelfareCtx, groupId: string): Promise<WelfareGroupDetail> {
  assertUuid(groupId, "Group");
  const { data: group, error } = await ctx.supabase.from("welfare_groups").select("*").eq("id", groupId).maybeSingle();
  if (error) fail(error, "We couldn't load the group.");
  if (!group) throw new BusinessRuleError("Group not found.", "not_found");
  const [{ data: members }, { data: beneficiaries }, { data: sponsors }, { data: contributions }, { data: claims }, { data: memberships }] = await Promise.all([
    ctx.supabase.from("welfare_members").select("*").eq("group_id", groupId).order("full_name").limit(5000),
    ctx.supabase.from("welfare_beneficiaries").select("*").eq("group_id", groupId).eq("status", "active").order("full_name").limit(10000),
    ctx.supabase.from("welfare_sponsors").select("*").eq("group_id", groupId).neq("status", "ended").limit(5000),
    ctx.supabase.from("welfare_contributions").select("*").eq("group_id", groupId).order("period_start").limit(20000),
    ctx.supabase.from("claims").select("id, reference, status, incident_type, welfare_member_id, created_at").eq("welfare_group_id", groupId).order("created_at", { ascending: false }).limit(100),
    ctx.supabase.from("memberships").select("org_id, org:organizations!memberships_org_id_fkey(type)").eq("user_id", ctx.userId).eq("active", true),
  ]);
  const me = (members ?? []).find((m) => m.user_id === ctx.userId) ?? null;
  const orgIds = new Set((memberships ?? []).map((m) => m.org_id));
  const isStaff = (memberships ?? []).some((m) => (m.org as unknown as { type: string } | null)?.type === "platform");
  const roles: WelfareRole[] = [];
  if (group.admin_user_id === ctx.userId || (me?.role === "admin" && me.status === "active")) roles.push("admin");
  if (me) roles.push("member");
  if ((sponsors ?? []).some((s) => s.sponsor_user_id === ctx.userId && s.status === "active")) roles.push("sponsor");
  if ((group.broker_org_id && orgIds.has(group.broker_org_id)) || (group.insurer_org_id && orgIds.has(group.insurer_org_id))) roles.push("partner");
  if (isStaff) roles.push("staff");
  const [broker, insurer, policy, request] = await Promise.all([
    group.broker_org_id ? ctx.supabase.from("organizations").select(ORG_COLS).eq("id", group.broker_org_id).maybeSingle().then((r) => r.data) : null,
    group.insurer_org_id ? ctx.supabase.from("organizations").select(ORG_COLS).eq("id", group.insurer_org_id).maybeSingle().then((r) => r.data) : null,
    group.policy_id ? ctx.supabase.from("policies").select("id, policy_number, internal_reference, status, cover_start, cover_end, premium, billing_period, customer_id").eq("id", group.policy_id).maybeSingle().then((r) => r.data) : null,
    group.request_id ? ctx.supabase.from("requests").select("id, reference, status, next_step").eq("id", group.request_id).maybeSingle().then((r) => r.data) : null,
  ]);
  const activeIds = (members ?? []).filter((m) => m.status === "active").map((m) => m.id);
  const summary = groupContributionSummary(activeIds, (contributions ?? []) as ContributionLike[]);
  const standings: Record<string, MemberStanding> = {};
  for (const s of summary.standings) standings[s.memberId] = s;
  for (const m of members ?? []) if (!standings[m.id]) standings[m.id] = memberStanding(m.id, (contributions ?? []) as ContributionLike[]);
  const isAdmin = roles.includes("admin") || isStaff;
  return {
    group,
    roles,
    isAdmin,
    me,
    members: members ?? [],
    beneficiaries: beneficiaries ?? [],
    sponsors: sponsors ?? [],
    contributions: contributions ?? [],
    summary,
    standings,
    broker: broker ?? null,
    insurer: insurer ?? null,
    policy: policy ?? null,
    request: request ?? null,
    claims: claims ?? [],
    joinUrl: isAdmin && group.invite_enabled ? `${siteUrl()}${welfareJoinPath(group.invite_token)}` : null,
  };
}

// ---------------------------------------------------------------------------
// Group lifecycle (admin)
// ---------------------------------------------------------------------------
export interface CreateWelfareGroupInput {
  name: string;
  kind: string;
  contributionAmount: number;
  cadence: string;
  contributionDay: number;
  description?: string | null;
  region?: string | null;
  memberPhone?: string | null;
}

export async function createWelfareGroup(ctx: WelfareCtx, input: CreateWelfareGroupInput): Promise<string> {
  const { data, error } = await ctx.supabase.rpc("create_welfare_group", {
    p_name: input.name,
    p_kind: input.kind,
    p_contribution_amount: input.contributionAmount,
    p_cadence: input.cadence,
    p_contribution_day: input.contributionDay,
    p_description: input.description ?? undefined,
    p_region: input.region ?? undefined,
    p_member_phone: input.memberPhone ?? undefined,
  });
  if (error || !data) fail(error, "We couldn't create the group.");
  log.info("welfare.group_created", { groupId: data, userId: ctx.userId });
  return data;
}

export async function updateWelfareGroup(ctx: WelfareCtx, groupId: string, patch: Partial<Pick<WelfareGroup, "name" | "kind" | "description" | "region" | "rules" | "contribution_amount" | "contribution_cadence" | "contribution_day" | "plan_starts_on" | "invite_enabled">>): Promise<void> {
  assertUuid(groupId, "Group");
  const { data, error } = await ctx.supabase.from("welfare_groups").update(patch).eq("id", groupId).select("id").maybeSingle();
  if (error) fail(error, "We couldn't save the group.");
  if (!data) throw new BusinessRuleError("Only the group admin can change the group.", "forbidden");
}

export async function cancelWelfareGroup(ctx: WelfareCtx, groupId: string): Promise<void> {
  assertUuid(groupId, "Group");
  const { data, error } = await ctx.supabase.from("welfare_groups").update({ status: "cancelled", invite_enabled: false }).eq("id", groupId).select("id").maybeSingle();
  if (error) fail(error, "We couldn't close the group.");
  if (!data) throw new BusinessRuleError("Only the group admin can close the group.", "forbidden");
}

/** Ask a licensed broker for quotes: a request for the group's category, always broker-routed, tagged with the group. */
export async function requestWelfareCover(ctx: WelfareCtx, groupId: string, opts: { notes?: string | null } = {}): Promise<{ requestId: string; reference: string }> {
  const detail = await welfareGroupDetail(ctx, groupId);
  if (!detail.isAdmin) throw new BusinessRuleError("Only the group admin can ask for quotes.", "forbidden");
  const { group } = detail;
  if (group.status === "cancelled") throw new BusinessRuleError("This group is closed.");
  if (detail.request && !["completed", "cancelled", "closed_no_cover"].includes(detail.request.status)) {
    throw new BusinessRuleError(`Quote request ${detail.request.reference} is still open for this group. Follow it from your requests.`, "conflict");
  }
  const active = detail.members.filter((m) => m.status === "active");
  if (active.length < 2) throw new BusinessRuleError("Enrol at least two active members before asking for quotes.");
  const svc = createServiceClient();
  const { data: cat } = group.category_id
    ? await svc.from("product_categories").select("slug, name").eq("id", group.category_id).maybeSingle()
    : await svc.from("product_categories").select("slug, name").eq("slug", "life-funeral").maybeSingle();
  if (!cat) throw new BusinessRuleError("Funeral cover is not available in the catalogue yet.");
  const ages = active.map((m) => (m.date_of_birth ? Math.floor((Date.now() - new Date(m.date_of_birth).getTime()) / 31_557_600_000) : null)).filter((a): a is number => a !== null);
  const risk: Record<string, unknown> = {
    scheme_type: "welfare_group",
    welfare_group_id: group.id,
    group_reference: group.reference,
    group_kind: group.kind,
    region: group.region,
    lives: active.length,
    members_with_date_of_birth: ages.length,
    average_age: ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null,
    oldest_age: ages.length ? Math.max(...ages) : null,
    beneficiaries_recorded: detail.beneficiaries.length,
    contribution_plan: { amount_ghs: Number(group.contribution_amount), cadence: group.contribution_cadence },
    renewal_of_policy: group.policy_id ?? null,
    notes: opts.notes?.trim().slice(0, 1000) || null,
  };
  const result = await createRequest(
    {
      categorySlug: cat.slug,
      risk,
      source: "web",
      type: group.policy_id ? "renewal" : "new_cover",
      relatedPolicyId: group.policy_id ?? undefined,
      brokerOfRecordId: group.broker_org_id,
      talkToExpert: true,
      welfareGroup: { id: group.id, title: `Group ${cat.name.toLowerCase()} · ${group.name} · ${active.length} lives` },
    },
    { supabase: ctx.supabase, userId: ctx.userId },
  );
  const { error } = await svc.from("welfare_groups").update({ request_id: result.request.id, status: group.status === "draft" ? "quoting" : group.status }).eq("id", group.id);
  if (error) log.warn("welfare.group_link_failed", { groupId, err: error });
  log.info("welfare.quote_requested", { groupId, requestId: result.request.id, lives: active.length });
  return { requestId: result.request.id, reference: result.request.reference };
}

// ---------------------------------------------------------------------------
// Members, beneficiaries, sponsors
// ---------------------------------------------------------------------------
export interface AddMemberInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: "female" | "male" | "other" | null;
  ghanaCardLast4?: string | null;
  /** The admin confirms the member agreed (on paper / in a meeting) — enrols them as active now. */
  consentAttested?: boolean;
  beneficiary?: { fullName: string; relationship: string; phone?: string | null } | null;
}

export async function addWelfareMember(ctx: WelfareCtx, groupId: string, input: AddMemberInput): Promise<WelfareMember> {
  assertUuid(groupId, "Group");
  const { data, error } = await ctx.supabase
    .from("welfare_members")
    .insert({
      group_id: groupId,
      full_name: input.fullName.trim().slice(0, 160),
      phone: input.phone?.trim().slice(0, 20) || null,
      email: input.email?.trim().toLowerCase().slice(0, 200) || null,
      date_of_birth: input.dateOfBirth || null,
      gender: input.gender ?? null,
      ghana_card_last4: input.ghanaCardLast4 || null,
      status: input.consentAttested ? "active" : "invited",
      consent_attested_by: input.consentAttested ? ctx.userId : null,
      joined_via: "admin",
    })
    .select("*")
    .single();
  if (error || !data) fail(error, "We couldn't add the member.");
  if (input.beneficiary?.fullName) {
    await ctx.supabase.from("welfare_beneficiaries").insert({ group_id: groupId, member_id: data.id, full_name: input.beneficiary.fullName.trim().slice(0, 160), relationship: input.beneficiary.relationship, phone: input.beneficiary.phone?.trim().slice(0, 20) || null });
  }
  return data;
}

export async function importWelfareMembers(ctx: WelfareCtx, groupId: string, csv: string, opts: { consentAttested?: boolean } = {}): Promise<{ added: number; skipped: { row: number; message: string }[] }> {
  assertUuid(groupId, "Group");
  const parsed = parseWelfareMemberCsv(csv);
  const skipped = [...parsed.errors];
  let added = 0;
  for (const r of parsed.rows) {
    try {
      await addWelfareMember(ctx, groupId, rowToInput(r, opts.consentAttested === true));
      added++;
    } catch (err) {
      skipped.push({ row: r.row, message: err instanceof BusinessRuleError ? err.message : "Could not be added." });
    }
  }
  return { added, skipped };
}
function rowToInput(r: WelfareMemberImportRow, consentAttested: boolean): AddMemberInput {
  return {
    fullName: r.full_name,
    phone: r.phone ?? null,
    email: r.email ?? null,
    dateOfBirth: r.date_of_birth ?? null,
    gender: r.gender ?? null,
    ghanaCardLast4: r.ghana_card_last4 ?? null,
    consentAttested,
    beneficiary: r.beneficiary_name ? { fullName: r.beneficiary_name, relationship: r.beneficiary_relationship ?? "other", phone: r.beneficiary_phone ?? null } : null,
  };
}

export type MemberStatusChange = "activate" | "suspend" | "remove" | "make_admin" | "make_member";

export async function changeWelfareMember(ctx: WelfareCtx, memberId: string, change: MemberStatusChange): Promise<WelfareMember> {
  assertUuid(memberId, "Member");
  const patch: Partial<WelfareMember> =
    change === "activate" ? { status: "active", consent_attested_by: ctx.userId }
    : change === "suspend" ? { status: "suspended" }
    : change === "remove" ? { status: "left" }
    : change === "make_admin" ? { role: "admin" }
    : { role: "member" };
  const { data, error } = await ctx.supabase.from("welfare_members").update(patch).eq("id", memberId).select("*").maybeSingle();
  if (error) fail(error, "We couldn't update the member.");
  if (!data) throw new BusinessRuleError("Only the group admin can change a member.", "forbidden");
  return data;
}

/** A member (or the admin) leaves / records consent for themselves. */
export async function consentWelfareMembership(ctx: WelfareCtx, memberId: string, consent: boolean): Promise<void> {
  assertUuid(memberId, "Membership");
  const { error } = await ctx.supabase.rpc("consent_welfare_membership", { p_member_id: memberId, p_consent: consent });
  if (error) fail(error, "We couldn't record your answer.");
}

export async function addWelfareBeneficiary(ctx: WelfareCtx, memberId: string, input: { fullName: string; relationship: string; phone?: string | null; dateOfBirth?: string | null; sharePct?: number | null }): Promise<WelfareBeneficiary> {
  assertUuid(memberId, "Member");
  const { data: member } = await ctx.supabase.from("welfare_members").select("group_id").eq("id", memberId).maybeSingle();
  if (!member) throw new BusinessRuleError("Member not found.", "not_found");
  const { data, error } = await ctx.supabase
    .from("welfare_beneficiaries")
    .insert({ group_id: member.group_id, member_id: memberId, full_name: input.fullName.trim().slice(0, 160), relationship: input.relationship, phone: input.phone?.trim().slice(0, 20) || null, date_of_birth: input.dateOfBirth || null, share_pct: input.sharePct ?? 100 })
    .select("*")
    .single();
  if (error || !data) fail(error, "We couldn't add the beneficiary.");
  return data;
}

export async function removeWelfareBeneficiary(ctx: WelfareCtx, beneficiaryId: string): Promise<void> {
  assertUuid(beneficiaryId, "Beneficiary");
  const { error } = await ctx.supabase.from("welfare_beneficiaries").update({ status: "removed" }).eq("id", beneficiaryId);
  if (error) fail(error, "We couldn't remove the beneficiary.");
}

export async function inviteWelfareSponsor(ctx: WelfareCtx, memberId: string, input: { name?: string | null; email?: string | null; phone?: string | null; currency?: string | null }): Promise<{ sponsor: WelfareSponsor; inviteUrl: string }> {
  assertUuid(memberId, "Member");
  const { data: member } = await ctx.supabase.from("welfare_members").select("group_id, full_name").eq("id", memberId).maybeSingle();
  if (!member) throw new BusinessRuleError("Member not found.", "not_found");
  if (!input.email && !input.phone) throw new BusinessRuleError("Give the sponsor's e-mail address or phone number.", "invalid_input");
  const { data, error } = await ctx.supabase
    .from("welfare_sponsors")
    .insert({ group_id: member.group_id, member_id: memberId, sponsor_name: input.name?.trim().slice(0, 160) || null, sponsor_email: input.email?.trim().toLowerCase().slice(0, 200) || null, sponsor_phone: input.phone?.trim().slice(0, 25) || null, display_currency: parseDisplayCurrency(input.currency) ?? "GHS" })
    .select("*")
    .single();
  if (error || !data) fail(error, "We couldn't invite the sponsor.");
  const inviteUrl = `${siteUrl()}${welfareSponsorPath(data.invite_token)}`;
  // Best-effort e-mail to the sponsor (notify fan-out needs a user; sponsors abroad may not have one yet).
  if (data.sponsor_email) {
    try {
      const { sendEmail, emailHtml } = await import("@/server/notify");
      const title = `${member.full_name} would like you to help with their welfare contributions`;
      const body = `Open the link to see ${member.full_name}'s contributions and pay them in your own currency. Covva records every contribution and settles it directly to the insurer — it never holds your money.`;
      await sendEmail({ to: data.sponsor_email, subject: title, html: emailHtml({ title, body, link: inviteUrl }, data.sponsor_name) });
    } catch (err) {
      log.warn("welfare.sponsor_invite_email_failed", { sponsorId: data.id, err });
    }
  }
  return { sponsor: data, inviteUrl };
}

export async function endWelfareSponsorship(ctx: WelfareCtx, sponsorId: string): Promise<void> {
  assertUuid(sponsorId, "Sponsorship");
  const { error } = await ctx.supabase.from("welfare_sponsors").update({ status: "ended" }).eq("id", sponsorId);
  if (error) fail(error, "We couldn't end the sponsorship.");
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------
export async function welfareInvitePreview(token: string): Promise<{ group: Pick<WelfareGroup, "id" | "name" | "kind" | "region" | "contribution_amount" | "contribution_cadence" | "member_count" | "status">; broker: string | null; insurer: string | null; consentText: string } | null> {
  if (!token || token.length > 80) return null;
  const svc = createServiceClient();
  const { data: g } = await svc.from("welfare_groups").select("id, name, kind, region, contribution_amount, contribution_cadence, member_count, status, invite_enabled, broker_org_id, insurer_org_id").eq("invite_token", token).maybeSingle();
  if (!g || !g.invite_enabled || g.status === "cancelled") return null;
  const names = async (id: string | null) => (id ? (await svc.from("organizations").select("name").eq("id", id).maybeSingle()).data?.name ?? null : null);
  return { group: g, broker: await names(g.broker_org_id), insurer: await names(g.insurer_org_id), consentText: WELFARE_CONSENT_TEXT };
}

export async function joinWelfareGroup(ctx: WelfareCtx, token: string, input: { fullName: string; phone?: string | null; consent: boolean }): Promise<{ memberId: string; groupId: string; status: string }> {
  const { data, error } = await ctx.supabase.rpc("join_welfare_group", { p_token: token, p_full_name: input.fullName, p_phone: input.phone ?? undefined, p_consent: input.consent });
  if (error || !data) fail(error, "We couldn't add you to the group.");
  const { data: m } = await ctx.supabase.from("welfare_members").select("id, group_id, status").eq("id", data).maybeSingle();
  if (!m) throw new BusinessRuleError("Membership not found.", "not_found");
  // Tell the admin when approval is needed.
  if (m.status === "pending") {
    const { data: g } = await ctx.supabase.from("welfare_groups").select("admin_user_id, name").eq("id", m.group_id).maybeSingle();
    if (g) await notify({ userId: g.admin_user_id, kind: "welfare.member_pending", title: `${input.fullName} asked to join ${g.name}`, body: "Approve them from the group's members list.", link: `/account/groups/${m.group_id}?tab=members`, data: { group_id: m.group_id, member_id: m.id }, channels: ["in_app", "push", "email"] }).catch(() => {});
  }
  return { memberId: m.id, groupId: m.group_id, status: m.status };
}

export async function sponsorInvitePreview(token: string): Promise<{ member: string; group: string; currency: string } | null> {
  if (!token || token.length > 80) return null;
  const svc = createServiceClient();
  const { data: s } = await svc.from("welfare_sponsors").select("member_id, group_id, display_currency, status").eq("invite_token", token).maybeSingle();
  if (!s || s.status === "ended") return null;
  const [{ data: m }, { data: g }] = await Promise.all([svc.from("welfare_members").select("full_name").eq("id", s.member_id).maybeSingle(), svc.from("welfare_groups").select("name").eq("id", s.group_id).maybeSingle()]);
  return m && g ? { member: m.full_name, group: g.name, currency: s.display_currency } : null;
}

export async function acceptWelfareSponsorship(ctx: WelfareCtx, token: string, currency?: string | null): Promise<string> {
  const { data, error } = await ctx.supabase.rpc("accept_welfare_sponsorship", { p_token: token, p_display_currency: parseDisplayCurrency(currency) ?? undefined });
  if (error || !data) fail(error, "We couldn't accept the invitation.");
  return data;
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------
export async function generateWelfareContributions(ctx: WelfareCtx, groupId: string, through?: string | null): Promise<number> {
  assertUuid(groupId, "Group");
  const { data, error } = await ctx.supabase.rpc("generate_welfare_contributions", { p_group_id: groupId, p_through: through ?? undefined });
  if (error) fail(error, "We couldn't generate the contributions.");
  return data ?? 0;
}

export async function waiveWelfareContribution(ctx: WelfareCtx, contributionId: string, note?: string | null): Promise<void> {
  assertUuid(contributionId, "Contribution");
  const { error } = await ctx.supabase.rpc("waive_welfare_contribution", { p_contribution_id: contributionId, p_note: note ?? undefined });
  if (error) fail(error, "We couldn't waive the contribution.");
}

export interface PayContributionsArgs {
  payerUserId: string;
  /** Contributions to settle (all for one group). */
  contributionIds: string[];
  channel: "mobile_money" | "card" | "link";
  momo?: { phone: string; provider: "mtn" | "vod" | "atl" } | null;
  /** Sponsor abroad: what they see; the charge and the settlement are the GHS amount. */
  displayCurrency?: string | null;
  callbackUrl?: string;
}

export interface PayContributionsResult {
  paymentId: string;
  reference: string;
  status: Enum<"payment_status">;
  authorizationUrl: string | null;
  displayText: string | null;
  amountGhs: number;
  count: number;
}

/**
 * Pay one or more due contributions in one payment on the group's master policy. The payer is the member, an
 * active sponsor of every member included, or a group admin (paying on a member's behalf). Settlement goes to
 * the insurer's subaccount with the broker's commission split; Covva only records who paid for whom.
 */
export async function payWelfareContributions(args: PayContributionsArgs): Promise<PayContributionsResult> {
  const svc = createServiceClient();
  const ids = [...new Set(args.contributionIds.filter((id) => UUID.test(id)))].slice(0, 60);
  if (!ids.length) throw new BusinessRuleError("Choose the contributions to pay.", "invalid_input");
  const { data: rows } = await svc.from("welfare_contributions").select("*").in("id", ids);
  if (!rows?.length) throw new BusinessRuleError("Contributions not found.", "not_found");
  const groupId = rows[0]!.group_id;
  if (rows.some((r) => r.group_id !== groupId)) throw new BusinessRuleError("Pay one group at a time.", "invalid_input");
  const unpaid = rows.filter((r) => r.status === "due" || r.status === "failed");
  if (!unpaid.length) throw new BusinessRuleError("These contributions are already settled.", "conflict");
  if (unpaid.length !== rows.length) throw new BusinessRuleError("Some of these contributions are already settled. Refresh and try again.", "conflict");

  const { data: group } = await svc.from("welfare_groups").select("*").eq("id", groupId).maybeSingle();
  if (!group) throw new BusinessRuleError("Group not found.", "not_found");
  if (!group.policy_id || !group.insurer_org_id) {
    throw new BusinessRuleError("Contributions can be paid once the broker has placed the group's cover with an insurer — Covva never collects money into its own account.", "business_rule");
  }
  if (group.status === "cancelled") throw new BusinessRuleError("This group is closed.");

  // Who is paying for whom.
  const memberIds = [...new Set(unpaid.map((r) => r.member_id))];
  const [{ data: members }, { data: sponsorships }, { data: adminRow }] = await Promise.all([
    svc.from("welfare_members").select("id, user_id, full_name, status, role").in("id", memberIds),
    svc.from("welfare_sponsors").select("id, member_id").eq("sponsor_user_id", args.payerUserId).eq("status", "active").in("member_id", memberIds),
    svc.from("welfare_members").select("id").eq("group_id", groupId).eq("user_id", args.payerUserId).eq("role", "admin").eq("status", "active").maybeSingle(),
  ]);
  const isAdmin = group.admin_user_id === args.payerUserId || !!adminRow;
  const via: Record<string, { paid_via: "member" | "sponsor" | "admin"; sponsor_id: string | null }> = {};
  for (const mId of memberIds) {
    const m = members?.find((x) => x.id === mId);
    const s = sponsorships?.find((x) => x.member_id === mId);
    if (m?.user_id === args.payerUserId) via[mId] = { paid_via: "member", sponsor_id: null };
    else if (s) via[mId] = { paid_via: "sponsor", sponsor_id: s.id };
    else if (isAdmin) via[mId] = { paid_via: "admin", sponsor_id: null };
    else throw new BusinessRuleError(`You can only pay your own contributions or those of members you sponsor.`, "forbidden");
  }
  const amount = Math.round(unpaid.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  const attempt = Date.now().toString(36);
  const key = `wc:${unpaid.map((r) => r.id.slice(0, 8)).sort().join(",").slice(0, 150)}:${attempt}`;
  const names = memberIds.map((id) => members?.find((m) => m.id === id)?.full_name ?? "member");
  const description = `${group.name}: ${unpaid.length} contribution${unpaid.length === 1 ? "" : "s"} for ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
  const tags: Record<string, string | string[] | boolean> = { welfare_contribution_ids: unpaid.map((r) => r.id), welfare_group_id: groupId, welfare_member_ids: memberIds, paid_via: [...new Set(Object.values(via).map((v) => v.paid_via))].join(",") };
  const r = await initiatePolicyCollection({
    policyId: group.policy_id,
    payerUserId: args.payerUserId,
    amount,
    tags,
    idempotencyKey: key,
    channel: args.channel,
    momo: args.momo ?? null,
    callbackUrl: args.callbackUrl ?? `${siteUrl()}/account/groups/${groupId}?tab=contributions`,
    description: description.slice(0, 120),
    displayCurrency: args.displayCurrency ?? null,
  });
  // Stamp the pending payment and the payer on the contributions (status stays due until the PSP confirms).
  for (const row of unpaid) {
    const v = via[row.member_id]!;
    await svc.from("welfare_contributions").update({ payment_id: r.paymentId, paid_by_user_id: args.payerUserId, paid_via: v.paid_via, sponsor_id: v.sponsor_id }).eq("id", row.id).in("status", ["due", "failed"]);
  }
  log.info("welfare.contribution_payment_started", { groupId, paymentId: r.paymentId, count: unpaid.length, amount, payer: args.payerUserId });
  return { ...r, amountGhs: amount, count: unpaid.length };
}

/** Outcome of a contribution payment (`raw_event.welfare_contribution_ids`), from `applyPaymentResult`. Idempotent. */
export async function applyWelfareContributionOutcome(svc: Svc, payment: Row<"payments">, outcome: PaymentOutcome): Promise<{ status: Enum<"payment_status"> | null; policyId?: string | null }> {
  const raw = (payment.raw_event && typeof payment.raw_event === "object" && !Array.isArray(payment.raw_event) ? payment.raw_event : {}) as Record<string, unknown>;
  const ids = (Array.isArray(raw.welfare_contribution_ids) ? raw.welfare_contribution_ids : []).filter((x): x is string => typeof x === "string");
  const event = (outcome.event ?? null) as Json;
  const { data: rows } = ids.length ? await svc.from("welfare_contributions").select("*").in("id", ids) : { data: [] as WelfareContribution[] };
  const groupId = rows?.[0]?.group_id;
  const { data: group } = groupId ? await svc.from("welfare_groups").select("*").eq("id", groupId).maybeSingle() : { data: null };
  if (!group || !rows?.length) {
    log.error("welfare.payment_orphan", { paymentId: payment.id });
    return { status: payment.status };
  }
  const parties = await contributionParties(svc, group, rows);
  if (outcome.status !== "succeeded") {
    if (payment.status !== "pending" && payment.status !== "processing") return { status: payment.status };
    const status = outcome.status === "abandoned" ? "abandoned" : "failed";
    const reason = outcome.failureReason ?? "Payment not completed";
    const { data: updated } = await svc.from("payments").update({ status, failure_reason: reason.slice(0, 500), raw_event: { ...raw, last_event: event } as Json }).eq("id", payment.id).in("status", ["pending", "processing"]).select("id");
    if (updated?.length) {
      await svc.from("welfare_contributions").update({ status: "failed" }).in("id", ids).in("status", ["due", "failed"]);
      await notify([...parties.payerAndMembers].map((userId) => ({ userId, kind: "payment.failed", title: `${group.name}: contribution payment not completed`, body: `${reason}. Try again from the group page; no money was taken.`, link: `/account/groups/${group.id}?tab=contributions`, data: { group_id: group.id, payment_id: payment.id } })));
    }
    return { status };
  }
  const expectedMinor = Math.round(Number(payment.amount) * 100);
  if ((outcome.amountMinor !== undefined && outcome.amountMinor < expectedMinor) || (outcome.currency && outcome.currency !== payment.currency)) {
    log.error("welfare.amount_mismatch", { paymentId: payment.id, expectedMinor, got: outcome.amountMinor });
    await svc.from("payments").update({ status: "failed", failure_reason: "Amount or currency did not match — referred to operations", raw_event: { ...raw, last_event: event } as Json }).eq("id", payment.id).in("status", ["pending", "processing"]);
    return { status: "failed" };
  }
  const paidAt = outcome.paidAt ?? new Date().toISOString();
  const { data: claimed } = await svc
    .from("payments")
    .update({ status: "succeeded", paid_at: paidAt, failure_reason: null, raw_event: { ...raw, last_event: event, confirmed_by: outcome.source } as Json })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");
  if (!claimed?.length) return { status: "succeeded", policyId: payment.policy_id };
  // Ledger: premium to the insurer, commission and platform fee (split recorded at initiation).
  await recordPaymentLedger(svc, { ...payment, status: "succeeded", paid_at: paidAt });
  const { error } = await svc
    .from("welfare_contributions")
    .update({ status: "paid", paid_at: paidAt, payment_id: payment.id, display_currency: payment.display_currency ?? null, display_amount: payment.display_amount != null ? Number(payment.display_amount) / rows.length : null, fx_rate: payment.fx_rate != null ? Number(payment.fx_rate) : null })
    .in("id", ids)
    .neq("status", "paid");
  if (error) log.error("welfare.mark_paid_failed", { paymentId: payment.id, err: error });
  if (payment.request_id) {
    await svc.from("request_events").insert({ request_id: payment.request_id, actor_party: "system", event: "payment_confirmed", note: `${rows.length} welfare contribution${rows.length === 1 ? "" : "s"} (${formatMoney(Number(payment.amount), "GHS")}) confirmed and paid to the insurer.`, data: { payment_id: payment.id, welfare_group_id: group.id } as Json });
  }
  const paidFor = parties.memberNames.join(", ");
  await notify([...parties.payerAndMembers].map((userId) => ({
    userId,
    kind: "payment.succeeded",
    title: `${group.name}: contribution paid`,
    body: `${formatMoney(Number(payment.amount), "GHS")} for ${paidFor} was paid to ${parties.insurerName ?? "the insurer"}${userId === payment.customer_id ? "" : ` by ${parties.payerName}`}.`,
    link: `/account/groups/${group.id}?tab=contributions`,
    data: { group_id: group.id, payment_id: payment.id },
  })));
  if (group.admin_user_id !== payment.customer_id && !parties.payerAndMembers.has(group.admin_user_id)) {
    await notify({ userId: group.admin_user_id, kind: "welfare.contribution_paid", title: `${group.name}: contribution received`, body: `${parties.payerName} paid ${formatMoney(Number(payment.amount), "GHS")} for ${paidFor}.`, link: `/account/groups/${group.id}?tab=contributions`, data: { group_id: group.id, payment_id: payment.id }, channels: ["in_app"] });
  }
  return { status: "succeeded", policyId: payment.policy_id };
}

async function contributionParties(svc: Svc, group: WelfareGroup, rows: WelfareContribution[]) {
  const memberIds = [...new Set(rows.map((r) => r.member_id))];
  const [{ data: members }, { data: payer }, { data: insurer }] = await Promise.all([
    svc.from("welfare_members").select("id, user_id, full_name").in("id", memberIds),
    rows[0]?.paid_by_user_id ? svc.from("profiles").select("full_name").eq("id", rows[0].paid_by_user_id).maybeSingle() : Promise.resolve({ data: null }),
    group.insurer_org_id ? svc.from("organizations").select("name").eq("id", group.insurer_org_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const payerAndMembers = new Set<string>();
  if (rows[0]?.paid_by_user_id) payerAndMembers.add(rows[0].paid_by_user_id);
  for (const m of members ?? []) if (m.user_id) payerAndMembers.add(m.user_id);
  return { payerAndMembers, memberNames: (members ?? []).map((m) => m.full_name), payerName: payer?.full_name ?? "a sponsor", insurerName: insurer?.name ?? null };
}

/** What a sponsor (or member) owes right now, allocated oldest first per member — for the pay form. */
export async function contributionsToPay(ctx: WelfareCtx, groupId: string, memberIds: string[], opts: { maxGhs?: number | null } = {}) {
  assertUuid(groupId, "Group");
  const { data } = await ctx.supabase.from("welfare_contributions").select("*").eq("group_id", groupId).in("member_id", memberIds).in("status", ["due", "failed"]).order("period_start");
  return allocateSponsorPayment((data ?? []) as ContributionLike[], memberIds, { maxGhs: opts.maxGhs ?? null });
}

// ---------------------------------------------------------------------------
// Reminders (notification abstraction: in-app / push / e-mail / SMS / WhatsApp per the user's preferences)
// ---------------------------------------------------------------------------
const REMIND_BEFORE_DAYS = 3;
const REMIND_AFTER_DAYS = 3;

/** Cron: upcoming contributions (due within 3 days) and overdue ones (3+ days late), once each. */
export async function sendWelfareReminders(svc: Svc, now = new Date()): Promise<Record<string, unknown>> {
  const today = isoDate(now);
  const soon = isoDate(new Date(now.getTime() + REMIND_BEFORE_DAYS * 86_400_000));
  const lateBy = isoDate(new Date(now.getTime() - REMIND_AFTER_DAYS * 86_400_000));
  const [{ data: upcoming }, { data: overdue }] = await Promise.all([
    svc.from("welfare_contributions").select("*").in("status", ["due", "failed"]).is("reminded_before_at", null).gte("due_at", today).lte("due_at", soon).limit(500),
    svc.from("welfare_contributions").select("*").in("status", ["due", "failed"]).is("reminded_after_at", null).lte("due_at", lateBy).limit(500),
  ]);
  let sent = 0;
  for (const [kind, rows] of [["before", upcoming ?? []], ["after", overdue ?? []]] as const) {
    for (const c of rows) {
      try {
        const n = await remindContribution(svc, c, kind);
        sent += n;
        await svc.from("welfare_contributions").update(kind === "before" ? { reminded_before_at: now.toISOString() } : { reminded_after_at: now.toISOString() }).eq("id", c.id);
      } catch (err) {
        log.warn("welfare.reminder_failed", { contributionId: c.id, err });
      }
    }
  }
  return { upcoming: upcoming?.length ?? 0, overdue: overdue?.length ?? 0, notifications: sent };
}

async function remindContribution(svc: Svc, c: WelfareContribution, kind: "before" | "after" | "manual"): Promise<number> {
  const [{ data: group }, { data: member }, { data: sponsors }] = await Promise.all([
    svc.from("welfare_groups").select("id, name, status, insurer_org_id").eq("id", c.group_id).maybeSingle(),
    svc.from("welfare_members").select("id, full_name, user_id, phone, status").eq("id", c.member_id).maybeSingle(),
    svc.from("welfare_sponsors").select("sponsor_user_id").eq("member_id", c.member_id).eq("status", "active"),
  ]);
  if (!group || !member || group.status === "cancelled" || member.status === "left") return 0;
  const amount = formatMoney(Number(c.amount), "GHS");
  const due = new Date(c.due_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const link = `/account/groups/${group.id}?tab=contributions`;
  const items = [];
  const title = kind === "after" ? `${group.name}: contribution overdue` : `${group.name}: contribution due ${due}`;
  if (member.user_id) {
    items.push({ userId: member.user_id, kind: "welfare.contribution_due", title, body: `${amount} for ${member.full_name}${kind === "after" ? ` was due on ${due}` : ` is due on ${due}`}. Pay from the group page by mobile money or card; it settles straight to the insurer.`, link, data: { group_id: group.id, contribution_id: c.id }, channels: ["in_app", "push", "whatsapp", "sms"] as const });
  }
  for (const s of sponsors ?? []) {
    if (s.sponsor_user_id && s.sponsor_user_id !== member.user_id) {
      items.push({ userId: s.sponsor_user_id, kind: "welfare.contribution_due", title, body: `${member.full_name}'s contribution of ${amount}${kind === "after" ? ` was due on ${due}` : ` is due on ${due}`}. You can pay it in your own currency from the group page.`, link, data: { group_id: group.id, contribution_id: c.id, member_id: member.id }, channels: ["in_app", "push", "email", "whatsapp"] as const });
    }
  }
  if (!items.length && member.phone) {
    // No account yet: a plain SMS to the member's phone (opt-out through the group admin).
    try {
      const { sendSms, normaliseGhanaPhone } = await import("@/server/notify");
      await sendSms(normaliseGhanaPhone(member.phone), `Covva: ${group.name} contribution of ${amount} ${kind === "after" ? "was" : "is"} due ${due}. Sign in at ${siteUrl()} with this number to pay; it goes straight to the insurer.`);
      return 1;
    } catch (err) {
      log.warn("welfare.reminder_sms_failed", { contributionId: c.id, err });
      return 0;
    }
  }
  await notify(items.map((i) => ({ ...i, channels: [...i.channels] })));
  return items.length;
}

/** Admin: remind a member (and their sponsors) about everything they owe, now. */
export async function remindWelfareMember(ctx: WelfareCtx, memberId: string): Promise<number> {
  assertUuid(memberId, "Member");
  const { data: member } = await ctx.supabase.from("welfare_members").select("id, group_id").eq("id", memberId).maybeSingle();
  if (!member) throw new BusinessRuleError("Member not found.", "not_found");
  const { data: group } = await ctx.supabase.from("welfare_groups").select("admin_user_id").eq("id", member.group_id).maybeSingle();
  const { data: adminRow } = await ctx.supabase.from("welfare_members").select("id").eq("group_id", member.group_id).eq("user_id", ctx.userId).eq("role", "admin").eq("status", "active").maybeSingle();
  if (!group || (group.admin_user_id !== ctx.userId && !adminRow)) throw new BusinessRuleError("Only the group admin can send reminders.", "forbidden");
  const svc = createServiceClient();
  const { data: rows } = await svc.from("welfare_contributions").select("*").eq("member_id", memberId).in("status", ["due", "failed"]).order("period_start").limit(1);
  if (!rows?.length) return 0;
  return remindContribution(svc, rows[0]!, "manual");
}

// ---------------------------------------------------------------------------
// Claims support (routed through the existing claims flow; only the insurer decides)
// ---------------------------------------------------------------------------
export interface WelfareClaimInput {
  memberId: string;
  kind: WelfareClaimKind | string;
  accidental?: boolean;
  incidentAt: string;
  description: string;
  location?: string | null;
  amountClaimed?: number | null;
  evidence?: ClaimEvidenceFile[];
}

export async function fileWelfareClaim(ctx: WelfareCtx, groupId: string, input: WelfareClaimInput): Promise<{ claimId: string; reference: string; checklist: ReturnType<typeof funeralClaimChecklist> }> {
  const detail = await welfareGroupDetail(ctx, groupId);
  assertUuid(input.memberId, "Member");
  const member = detail.members.find((m) => m.id === input.memberId);
  if (!member) throw new BusinessRuleError("Member not found on this group.", "not_found");
  // Who may raise it: an admin, the member themselves (welfare claims) or a linked beneficiary of the member.
  const svc = createServiceClient();
  const { data: beneficiaryRow } = await svc.from("welfare_beneficiaries").select("id").eq("member_id", member.id).eq("user_id", ctx.userId).eq("status", "active").maybeSingle();
  const isBeneficiary = !!beneficiaryRow;
  const isSelf = member.user_id === ctx.userId;
  if (!detail.isAdmin && !isSelf && !isBeneficiary) throw new BusinessRuleError("Only the group admin, the member or a recorded beneficiary can raise this claim.", "forbidden");
  if (!detail.group.policy_id || !detail.policy) throw new BusinessRuleError("The group has no policy in force yet, so there is nothing to claim against. Contact your broker.");
  const checklist = funeralClaimChecklist(input.kind, { accidental: input.accidental, claimantIsBeneficiary: !detail.isAdmin });
  const result = await createClaim(svc, {
    policyId: detail.group.policy_id,
    customerId: detail.policy.customer_id,
    incidentType: welfareIncidentType(input.kind, input.accidental),
    incidentAt: input.incidentAt,
    location: input.location ?? null,
    description: `${member.full_name} (${detail.group.name}, ${detail.group.reference}): ${input.description}`.slice(0, 4000),
    amountClaimed: input.amountClaimed ?? null,
    reportedByUserId: ctx.userId,
    evidence: input.evidence,
    requiredEvidence: checklist,
    source: "web",
  });
  const { error } = await svc.from("claims").update({ welfare_group_id: detail.group.id, welfare_member_id: member.id }).eq("id", result.claim.id);
  if (error) log.error("welfare.claim_tag_failed", { claimId: result.claim.id, err: error });
  await svc.from("claim_events").insert({ claim_id: result.claim.id, actor_id: ctx.userId, actor_party: "customer", note: `Welfare group claim for ${member.full_name}, raised by ${detail.isAdmin ? "the group admin" : isSelf ? "the member" : "a recorded beneficiary"}. Enrolment and contribution records are attached from the group.`, visible_to_customer: true });
  // The member (if linked) and the admin follow the claim.
  const watchers = new Set<string>([detail.group.admin_user_id]);
  if (member.user_id) watchers.add(member.user_id);
  watchers.delete(ctx.userId);
  await notify([...watchers].map((userId) => ({ userId, kind: "claim.reported", title: `Claim ${result.claim.reference} raised for ${member.full_name}`, body: `${detail.group.name}: a ${String(input.kind).replace(/_/g, " ")} claim was reported to the broker. Only the insurer decides the claim.`, link: `/account/claims/${result.claim.id}`, data: { claim_id: result.claim.id, group_id: detail.group.id }, channels: ["in_app", "push", "email"] }))).catch(() => {});
  if (detail.group.broker_org_id) {
    await notifyOrg(detail.group.broker_org_id, { kind: "claim.reported", title: `Welfare group claim · ${detail.group.name}`, body: `${result.claim.reference}: ${String(input.kind).replace(/_/g, " ")} for ${member.full_name}. The group's enrolment and contribution records are on the claim.`, link: `/partner/claims/${result.claim.id}`, data: { claim_id: result.claim.id, welfare_group_id: detail.group.id }, channels: ["in_app", "email"] }).catch(() => {});
  }
  return { claimId: result.claim.id, reference: result.claim.reference, checklist };
}

// ---------------------------------------------------------------------------
// Partner workspace (broker of record / insurer) — RLS already scopes to the org's groups
// ---------------------------------------------------------------------------
export interface PartnerWelfareGroupRow {
  group: WelfareGroup;
  summary: GroupContributionSummary;
  activeMembers: number;
  openClaims: number;
}

export async function partnerWelfareGroups(ctx: WelfareCtx, orgId: string): Promise<PartnerWelfareGroupRow[]> {
  const { data: groups } = await ctx.supabase.from("welfare_groups").select("*").or(`broker_org_id.eq.${orgId},insurer_org_id.eq.${orgId}`).order("created_at", { ascending: false }).limit(200);
  if (!groups?.length) return [];
  const ids = groups.map((g) => g.id);
  const [{ data: members }, { data: contributions }, { data: claims }] = await Promise.all([
    ctx.supabase.from("welfare_members").select("id, group_id, status").in("group_id", ids).limit(20000),
    ctx.supabase.from("welfare_contributions").select("*").in("group_id", ids).limit(50000),
    ctx.supabase.from("claims").select("id, welfare_group_id, status").in("welfare_group_id", ids).limit(2000),
  ]);
  return groups.map((g) => {
    const active = (members ?? []).filter((m) => m.group_id === g.id && m.status === "active");
    return {
      group: g,
      summary: groupContributionSummary(active.map((m) => m.id), ((contributions ?? []) as ContributionLike[]).filter((c) => (c as WelfareContribution).group_id === g.id)),
      activeMembers: active.length,
      openClaims: (claims ?? []).filter((c) => c.welfare_group_id === g.id && !["paid", "closed", "withdrawn", "rejected"].includes(c.status)).length,
    };
  });
}

export const contributionStatusMeta = (status: string) => CONTRIBUTION_STATUS[status as keyof typeof CONTRIBUTION_STATUS] ?? { label: status, tone: "neutral" as const };
