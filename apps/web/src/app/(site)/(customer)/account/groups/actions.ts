"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GHANA_REGIONS, WELFARE_CLAIM_KIND_VALUES, WELFARE_GROUP_KIND_VALUES, WELFARE_RELATIONSHIP_VALUES, ghanaCardLast4 } from "@im/core";
import type { FormState } from "@/components/partner/action-form";
import { normaliseGhanaPhone, parseUploads, type ActionState } from "@/components/customer/utils";
import { BusinessRuleError } from "@/server/requests";
import {
  acceptWelfareSponsorship,
  addWelfareBeneficiary,
  addWelfareMember,
  cancelWelfareGroup,
  changeWelfareMember,
  consentWelfareMembership,
  createWelfareGroup,
  endWelfareSponsorship,
  fileWelfareClaim,
  generateWelfareContributions,
  importWelfareMembers,
  inviteWelfareSponsor,
  joinWelfareGroup,
  payWelfareContributions,
  remindWelfareMember,
  removeWelfareBeneficiary,
  requestWelfareCover,
  updateWelfareGroup,
  waiveWelfareContribution,
  type WelfareCtx,
} from "@/server/welfare";
import { log } from "@/server/log";
import { actionContext } from "../_lib/action";

/**
 * Welfare group Server Actions. Every action re-verifies the session (actions are public POST endpoints); the
 * database guards and RLS are the final boundary (members see their group, admins manage it, sponsors see the
 * members they pay for).
 */
const uuid = z.string().uuid();
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const MAX_CSV = 900 * 1024;

async function ctx(): Promise<WelfareCtx | null> {
  const { supabase, user } = await actionContext();
  return user ? { supabase, userId: user.id } : null;
}

async function run(fn: (c: WelfareCtx) => Promise<FormState>): Promise<FormState> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Your session has ended. Please sign in again." };
  try {
    return await fn(c);
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the details and try again." };
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    log.error("welfare.action_failed", { err });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const groupPath = (id: string, tab?: string) => `/account/groups/${id}${tab ? `?tab=${tab}` : ""}`;

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------
const CreateGroup = z.object({
  name: z.string().trim().min(2, "Enter the group's name").max(160),
  kind: z.enum(WELFARE_GROUP_KIND_VALUES, { error: "Choose the type of group" }),
  contribution_amount: z.string().trim().regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter the contribution per member in cedis").transform(Number),
  cadence: z.enum(["monthly", "quarterly", "annual"], { error: "Choose how often members contribute" }),
  contribution_day: z.string().trim().regex(/^([1-9]|1\d|2[0-8])$/, "Choose a day between 1 and 28").transform(Number),
  description: opt(2000),
  region: z.enum(GHANA_REGIONS as unknown as [string, ...string[]]).optional().or(z.literal("").transform(() => undefined)),
  phone: opt(20),
});

export async function createGroupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  let id: string | null = null;
  const res = await run(async (c) => {
    const d = CreateGroup.parse(Object.fromEntries(fd));
    const phone = d.phone ? normaliseGhanaPhone(d.phone) : null;
    if (d.phone && !phone) return { ok: false, error: "Enter a Ghana phone number, e.g. 024 123 4567." };
    id = await createWelfareGroup(c, { name: d.name, kind: d.kind, contributionAmount: d.contribution_amount, cadence: d.cadence, contributionDay: d.contribution_day, description: d.description ?? null, region: d.region ?? null, memberPhone: phone });
    return { ok: true };
  });
  if (res.ok && id) redirect(groupPath(id));
  return res;
}

const UpdatePlan = z.object({
  groupId: uuid,
  name: z.string().trim().min(2).max(160),
  description: opt(2000),
  rules: opt(4000),
  contribution_amount: z.string().trim().regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter the contribution per member in cedis").transform(Number),
  cadence: z.enum(["monthly", "quarterly", "annual"]),
  contribution_day: z.string().trim().regex(/^([1-9]|1\d|2[0-8])$/, "Choose a day between 1 and 28").transform(Number),
  invite_enabled: z.string().optional(),
});

export async function updatePlanAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const d = UpdatePlan.parse(Object.fromEntries(fd));
    await updateWelfareGroup(c, d.groupId, { name: d.name, description: d.description ?? null, rules: d.rules ?? null, contribution_amount: d.contribution_amount, contribution_cadence: d.cadence, contribution_day: d.contribution_day, invite_enabled: d.invite_enabled === "on" });
    revalidatePath(groupPath(d.groupId));
    return { ok: true, message: "Saved. New contributions use the updated plan; existing ones are unchanged." };
  });
}

export async function cancelGroupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const groupId = uuid.parse(fd.get("groupId"));
    await cancelWelfareGroup(c, groupId);
    revalidatePath("/account/groups");
    return { ok: true, message: "The group is closed. Existing cover runs to its end date with the insurer." };
  });
}

export async function requestCoverAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const groupId = uuid.parse(fd.get("groupId"));
    const notes = opt(1000).parse(fd.get("notes") ?? undefined);
    const r = await requestWelfareCover(c, groupId, { notes: notes ?? null });
    revalidatePath(groupPath(groupId));
    return { ok: true, message: `Request ${r.reference} sent. A licensed broker will approach insurers for the group; you will see quotes under Requests.` };
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
const AddMember = z.object({
  groupId: uuid,
  full_name: z.string().trim().min(2, "Enter the member's full name").max(160),
  phone: opt(20),
  email: z.string().trim().toLowerCase().max(200).optional().or(z.literal("")).transform((v) => v || undefined),
  date_of_birth: opt(10),
  gender: z.enum(["female", "male", "other"]).optional().or(z.literal("").transform(() => undefined)),
  ghana_card: opt(20),
  consent_attested: z.string().optional(),
  beneficiary_name: opt(160),
  beneficiary_relationship: z.enum(WELFARE_RELATIONSHIP_VALUES).optional().or(z.literal("").transform(() => undefined)),
  beneficiary_phone: opt(20),
});

export async function addMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const d = AddMember.parse(Object.fromEntries(fd));
    const phone = d.phone ? normaliseGhanaPhone(d.phone) : null;
    if (d.phone && !phone) return { ok: false, error: "Enter a Ghana phone number, e.g. 024 123 4567." };
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return { ok: false, error: "Enter a valid e-mail address." };
    const bPhone = d.beneficiary_phone ? normaliseGhanaPhone(d.beneficiary_phone) : null;
    if (d.beneficiary_phone && !bPhone) return { ok: false, error: "Enter a Ghana phone number for the beneficiary." };
    const m = await addWelfareMember(c, d.groupId, {
      fullName: d.full_name,
      phone,
      email: d.email ?? null,
      dateOfBirth: d.date_of_birth || null,
      gender: d.gender ?? null,
      ghanaCardLast4: d.ghana_card ? ghanaCardLast4(d.ghana_card) : null,
      consentAttested: d.consent_attested === "on",
      beneficiary: d.beneficiary_name ? { fullName: d.beneficiary_name, relationship: d.beneficiary_relationship ?? "other", phone: bPhone } : null,
    });
    revalidatePath(groupPath(d.groupId));
    return { ok: true, message: m.status === "active" ? `${m.full_name} is enrolled.` : `${m.full_name} is invited. They become active when they join with the link, sign in with that phone number, or you confirm their consent.` };
  });
}

export async function importMembersAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const groupId = uuid.parse(fd.get("groupId"));
    const file = fd.get("file");
    const pasted = typeof fd.get("csv") === "string" ? String(fd.get("csv")) : "";
    let text = pasted;
    if (file instanceof File && file.size) {
      if (file.size > MAX_CSV) return { ok: false, error: "The file is larger than 900 KB. Split it." };
      text = await file.text();
    }
    if (!text.trim()) return { ok: false, error: "Upload a CSV file or paste the rows." };
    const r = await importWelfareMembers(c, groupId, text, { consentAttested: fd.get("consent_attested") === "on" });
    revalidatePath(groupPath(groupId, "members"));
    const skipped = r.skipped.slice(0, 5).map((s) => `row ${s.row}: ${s.message}`).join("; ");
    return { ok: r.added > 0 || r.skipped.length === 0, message: `${r.added} member${r.added === 1 ? "" : "s"} added${r.skipped.length ? `, ${r.skipped.length} skipped (${skipped}${r.skipped.length > 5 ? "…" : ""})` : ""}.`, error: r.added === 0 && r.skipped.length ? `Nothing was added: ${skipped}` : undefined };
  });
}

const ChangeMember = z.object({ memberId: uuid, groupId: uuid, change: z.enum(["activate", "suspend", "remove", "make_admin", "make_member"]) });

export async function changeMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const d = ChangeMember.parse(Object.fromEntries(fd));
    const m = await changeWelfareMember(c, d.memberId, d.change);
    revalidatePath(groupPath(d.groupId));
    const text: Record<typeof d.change, string> = { activate: `${m.full_name} is now active.`, suspend: `${m.full_name} is suspended.`, remove: `${m.full_name} has left the group.`, make_admin: `${m.full_name} can now manage the group.`, make_member: `${m.full_name} is a regular member again.` };
    return { ok: true, message: text[d.change] };
  });
}

export async function remindMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const memberId = uuid.parse(fd.get("memberId"));
    const n = await remindWelfareMember(c, memberId);
    return { ok: true, message: n ? "Reminder sent." : "Nothing is owed, or the member has no phone or account to reach." };
  });
}

export async function leaveGroupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const memberId = uuid.parse(fd.get("memberId"));
    await consentWelfareMembership(c, memberId, false);
    revalidatePath("/account/groups");
    return { ok: true, message: "You have left the group." };
  });
}

export async function consentMembershipAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const memberId = uuid.parse(fd.get("memberId"));
    if (fd.get("consent") !== "on") return { ok: false, error: "Tick the box to agree to be enrolled." };
    await consentWelfareMembership(c, memberId, true);
    revalidatePath("/account/groups");
    return { ok: true, message: "Thank you — you are enrolled." };
  });
}

// ---------------------------------------------------------------------------
// Beneficiaries and sponsors
// ---------------------------------------------------------------------------
const AddBeneficiary = z.object({
  memberId: uuid,
  groupId: uuid,
  full_name: z.string().trim().min(2, "Enter the beneficiary's full name").max(160),
  relationship: z.enum(WELFARE_RELATIONSHIP_VALUES, { error: "Choose the relationship" }),
  phone: opt(20),
  date_of_birth: opt(10),
  share_pct: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/).optional().or(z.literal("")).transform((v) => (v ? Number(v) : undefined)),
});

export async function addBeneficiaryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const d = AddBeneficiary.parse(Object.fromEntries(fd));
    const phone = d.phone ? normaliseGhanaPhone(d.phone) : null;
    if (d.phone && !phone) return { ok: false, error: "Enter a Ghana phone number for the beneficiary." };
    await addWelfareBeneficiary(c, d.memberId, { fullName: d.full_name, relationship: d.relationship, phone, dateOfBirth: d.date_of_birth || null, sharePct: d.share_pct ?? null });
    revalidatePath(groupPath(d.groupId));
    return { ok: true, message: "Beneficiary recorded." };
  });
}

export async function removeBeneficiaryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const id = uuid.parse(fd.get("beneficiaryId"));
    const groupId = uuid.parse(fd.get("groupId"));
    await removeWelfareBeneficiary(c, id);
    revalidatePath(groupPath(groupId));
    return { ok: true, message: "Beneficiary removed." };
  });
}

const InviteSponsor = z.object({ memberId: uuid, groupId: uuid, name: opt(160), email: z.string().trim().toLowerCase().max(200).optional().or(z.literal("")).transform((v) => v || undefined), phone: opt(25), currency: z.enum(["GHS", "GBP", "USD", "EUR", "CAD"]).optional() });

export async function inviteSponsorAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const d = InviteSponsor.parse(Object.fromEntries(fd));
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return { ok: false, error: "Enter a valid e-mail address." };
    const r = await inviteWelfareSponsor(c, d.memberId, { name: d.name ?? null, email: d.email ?? null, phone: d.phone ?? null, currency: d.currency ?? null });
    revalidatePath(groupPath(d.groupId));
    return { ok: true, message: `Invitation ready${d.email ? " and e-mailed" : ""}. Share this link with the sponsor: ${r.inviteUrl}`, data: { url: r.inviteUrl } };
  });
}

export async function endSponsorshipAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const id = uuid.parse(fd.get("sponsorId"));
    await endWelfareSponsorship(c, id);
    revalidatePath("/account/groups");
    return { ok: true, message: "Sponsorship ended." };
  });
}

// ---------------------------------------------------------------------------
// Joining / accepting
// ---------------------------------------------------------------------------
const Join = z.object({ token: z.string().min(8).max(80), full_name: z.string().trim().min(2, "Enter your full name").max(160), phone: opt(20), consent: z.string().optional() });

export async function joinGroupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  let groupId: string | null = null;
  const res = await run(async (c) => {
    const d = Join.parse(Object.fromEntries(fd));
    const phone = d.phone ? normaliseGhanaPhone(d.phone) : null;
    if (d.phone && !phone) return { ok: false, error: "Enter a Ghana phone number, e.g. 024 123 4567." };
    const r = await joinWelfareGroup(c, d.token, { fullName: d.full_name, phone, consent: d.consent === "on" });
    groupId = r.groupId;
    return { ok: true, message: r.status === "pending" ? "Request sent — the group admin will approve you." : "You are enrolled." };
  });
  if (res.ok && groupId) redirect(groupPath(groupId));
  return res;
}

export async function acceptSponsorAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await run(async (c) => {
    const token = z.string().min(8).max(80).parse(fd.get("token"));
    const currency = z.enum(["GHS", "GBP", "USD", "EUR", "CAD"]).optional().parse(fd.get("currency") || undefined);
    await acceptWelfareSponsorship(c, token, currency ?? null);
    return { ok: true };
  });
  if (res.ok) redirect("/account/groups");
  return res;
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------
export async function generateContributionsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const groupId = uuid.parse(fd.get("groupId"));
    const ahead = fd.get("ahead") === "on";
    const through = ahead ? new Date(Date.now() + 92 * 86_400_000).toISOString().slice(0, 10) : undefined;
    const n = await generateWelfareContributions(c, groupId, through);
    revalidatePath(groupPath(groupId, "contributions"));
    return { ok: true, message: n ? `${n} contribution${n === 1 ? "" : "s"} added to the schedule.` : "The schedule is already up to date." };
  });
}

export async function waiveContributionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const id = uuid.parse(fd.get("contributionId"));
    const groupId = uuid.parse(fd.get("groupId"));
    const note = opt(500).parse(fd.get("note") ?? undefined);
    await waiveWelfareContribution(c, id, note ?? null);
    revalidatePath(groupPath(groupId, "contributions"));
    return { ok: true, message: "Contribution waived." };
  });
}

const Method = z.enum(["mtn", "vod", "atl", "card"]);

/** Pay the given contributions (bound: ids + the payer's display currency). */
export async function payContributionsAction(bound: { contributionIds: string[]; groupId: string; displayCurrency: string | null }, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return { ok: false, error: "Your session has ended. Please sign in again." };
  const method = Method.safeParse(fd.get("method"));
  if (!method.success) return { ok: false, error: "Choose how to pay." };
  let momo: { phone: string; provider: "mtn" | "vod" | "atl" } | null = null;
  if (method.data !== "card") {
    const phone = normaliseGhanaPhone(String(fd.get("phone") ?? ""));
    if (!phone) return { ok: false, error: "Enter the mobile money number.", fieldErrors: { phone: "Enter the mobile money number, e.g. 024 123 4567" } };
    momo = { phone, provider: method.data };
  }
  try {
    const r = await payWelfareContributions({ payerUserId: user.id, contributionIds: bound.contributionIds, channel: momo ? "mobile_money" : "card", momo, displayCurrency: bound.displayCurrency });
    revalidatePath(groupPath(bound.groupId, "contributions"));
    if (r.authorizationUrl) return { ok: true, message: "Opening the payment page…", data: { url: r.authorizationUrl } };
    if (r.status === "succeeded") return { ok: true, message: "Paid. The insurer has received the contribution." };
    return { ok: true, message: r.displayText ?? "Approve the prompt on your phone to pay." };
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    log.error("welfare.pay_failed", { err });
    return { ok: false, error: "We couldn't start the payment. No money has been taken." };
  }
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
const Claim = z.object({
  groupId: uuid,
  memberId: uuid,
  kind: z.enum(WELFARE_CLAIM_KIND_VALUES, { error: "Choose what happened" }),
  accidental: z.string().optional(),
  incident_at: z.string().min(10, "Enter the date"),
  description: z.string().trim().min(20, "Describe what happened in a few sentences (at least 20 characters)").max(4000),
  location: opt(300),
  amount_claimed: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/).optional().or(z.literal("")).transform((v) => (v ? Number(v) : undefined)),
  evidence: z.string().optional(),
});

export async function fileClaimAction(_prev: FormState, fd: FormData): Promise<FormState> {
  let claimId: string | null = null;
  const res = await run(async (c) => {
    const d = Claim.parse(Object.fromEntries(fd));
    const evidence = parseUploads(d.evidence ?? null, c.userId);
    const r = await fileWelfareClaim(c, d.groupId, { memberId: d.memberId, kind: d.kind, accidental: d.accidental === "on", incidentAt: d.incident_at, description: d.description, location: d.location ?? null, amountClaimed: d.amount_claimed ?? null, evidence });
    claimId = r.claimId;
    return { ok: true, message: `Claim ${r.reference} reported to the broker.` };
  });
  if (res.ok && claimId) redirect(`/account/claims/${claimId}`);
  return res;
}
