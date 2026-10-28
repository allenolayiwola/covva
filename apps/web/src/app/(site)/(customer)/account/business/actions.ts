"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { BUSINESS_ROLES, FLEET_USES, GHANA_REGIONS, GROUP_SCHEME_CATEGORIES, ASSET_KINDS } from "@im/core";
import type { FormState } from "@/components/partner/action-form";
import type { ActionState } from "@/components/customer/utils";
import { BusinessRuleError } from "@/server/requests";
import {
  addAsset,
  addMember,
  addVehicle,
  createBusinessAccount,
  createScheme,
  importFleet,
  importMembers,
  inviteBusinessUser,
  payInvoice,
  removeAsset,
  removeMember,
  removeVehicle,
  requestFleetQuote,
  requestGroupQuote,
  requestPropertyQuote,
  updateTeamMember,
  type BusinessCtx,
} from "@/server/business";
import { log } from "@/server/log";
import { actionContext } from "../_lib/action";

/**
 * Business workspace Server Actions. Every action re-verifies the session (actions are public POST endpoints) and
 * server/business.ts re-checks the caller's role in the business account; RLS is the final boundary.
 */
const uuid = z.string().uuid();
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const MAX_FILE = 900 * 1024;

async function ctx(): Promise<BusinessCtx | null> {
  const { supabase, user } = await actionContext();
  return user ? { supabase, userId: user.id, source: "web" } : null;
}

async function run(fn: (c: BusinessCtx) => Promise<FormState>): Promise<FormState> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Your session has ended. Please sign in again." };
  try {
    return await fn(c);
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the details and try again." };
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    log.error("business.action_failed", { err });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
const CreateBusiness = z.object({
  name: z.string().trim().min(2, "Enter the business name").max(160, "Keep the name under 160 characters"),
  legal_name: opt(160),
  industry: z.string().trim().min(2, "Tell us the industry or type of business").max(120),
  employees: z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, "Enter the number of employees")
    .transform(Number),
  tin: z
    .string()
    .trim()
    .max(40)
    .optional()
    .refine((v) => !v || /^[A-Z0-9-]{6,20}$/i.test(v), "Enter a valid TIN (e.g. C0012345678)")
    .transform((v) => v || undefined),
  registration_number: opt(60),
  billing_email: z.string().trim().toLowerCase().email("Enter a valid billing email"),
  billing_contact: z.string().trim().min(2, "Who should receive statements?").max(120),
  phone: opt(20),
  region: z.enum(GHANA_REGIONS as unknown as [string, ...string[]], { error: "Choose a region" }).optional().or(z.literal("").transform(() => undefined)),
  address: opt(300),
  authorised: z.literal("on", { error: "Confirm you can act for this business" }),
});

/** Create a business account; the caller becomes its owner. */
export async function createBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Your session has ended. Please sign in again." };
  const parsed = CreateBusiness.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "_")] ??= i.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  let orgId: string;
  try {
    ({ orgId } = await createBusinessAccount(c.userId, parsed.data, { supabase: c.supabase }));
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    log.error("business.create_failed", { err });
    return { ok: false, error: "We couldn't create the business account. Please try again." };
  }
  redirect(`/account/business?org=${orgId}&created=1`);
}

// ---------------------------------------------------------------------------
// Schemes & members
// ---------------------------------------------------------------------------
export async function createSchemeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z.object({ orgId: uuid, name: z.string().trim().min(2, "Name the scheme").max(160), categorySlug: z.enum(GROUP_SCHEME_CATEGORIES, { error: "Choose the type of cover" }) }).parse(Object.fromEntries(fd));
    const scheme = await createScheme(c, v.orgId, { name: v.name, categorySlug: v.categorySlug });
    refresh();
    return { ok: true, message: `Scheme ${scheme.reference} created. Add members next.`, data: { schemeId: scheme.id } };
  });
}

const MemberForm = z.object({
  schemeId: uuid,
  full_name: z.string().trim().min(2, "Enter the member's name").max(160),
  employee_ref: opt(60),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth").optional().or(z.literal("").transform(() => undefined)),
  gender: z.enum(["female", "male", "other"]).optional().or(z.literal("").transform(() => undefined)),
  phone: opt(20),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  ghana_card: opt(20),
  relationship: z.enum(["employee", "spouse", "child", "parent"]).default("employee"),
  principal_member_id: uuid.optional().or(z.literal("").transform(() => undefined)),
  cover_tier: opt(60),
  salary_band: opt(60),
});

export async function addMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = MemberForm.parse(Object.fromEntries(fd));
    const m = await addMember(c, v.schemeId, v);
    refresh();
    return { ok: true, message: `${m.full_name} added.` };
  });
}

export async function removeMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const r = await removeMember(c, uuid.parse(fd.get("memberId")));
    refresh();
    return { ok: true, message: r.removed > 1 ? `Removed with ${r.removed - 1} dependant${r.removed === 2 ? "" : "s"}.` : "Member removed." };
  });
}

async function readCsv(fd: FormData): Promise<string> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new BusinessRuleError("Choose a CSV file to upload.", "invalid_input");
  if (file.size > MAX_FILE) throw new BusinessRuleError("The file is larger than 900 KB. Split it into smaller files.", "invalid_input");
  return file.text();
}

/** Members CSV: `mode=preview` validates only (row errors + preview), `mode=import` writes the valid rows. */
export async function importMembersAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const schemeId = uuid.parse(fd.get("schemeId"));
    const mode = fd.get("mode") === "import" ? "import" : "preview";
    const r = await importMembers(c, schemeId, await readCsv(fd), { mode });
    if (mode === "import") refresh();
    const problems = r.errors.length + r.skipped.length;
    return {
      ok: true,
      message:
        mode === "preview"
          ? r.valid ? `${r.valid} row${r.valid === 1 ? "" : "s"} ready to import, ${problems} with problems. Review below, then import.` : "No valid rows found. Fix the problems below and try again."
          : `Imported ${r.inserted} member${r.inserted === 1 ? "" : "s"}. ${problems} row${problems === 1 ? "" : "s"} not imported.`,
      data: { mode, valid: r.valid, inserted: r.inserted, errors: JSON.stringify([...r.errors, ...r.skipped].sort((a, b) => a.row - b.row)), preview: JSON.stringify(r.preview) },
    };
  });
}

export async function requestGroupQuoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z.object({ schemeId: uuid, notes: opt(1000) }).parse(Object.fromEntries(fd));
    const r = await requestGroupQuote(c, v.schemeId, { notes: v.notes });
    refresh();
    return { ok: true, message: `Request ${r.reference} sent. A licensed broker reviews your census and approaches insurers — you'll compare quotes here.`, data: { requestId: r.requestId } };
  });
}

// ---------------------------------------------------------------------------
// Fleet & assets
// ---------------------------------------------------------------------------
const Money = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return undefined;
  const n = Number(v.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: "custom", message: "Enter an amount in GH₵" });
    return z.NEVER;
  }
  return n;
});

export async function addVehicleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z
      .object({
        orgId: uuid,
        registration: z.string().trim().min(2, "Enter the registration").max(20),
        make: opt(60),
        model: opt(60),
        year: z.string().trim().optional().transform((y) => (y ? Number(y) : undefined)).refine((y) => y === undefined || (Number.isInteger(y) && y >= 1950 && y <= new Date().getFullYear() + 1), "Enter a valid year"),
        value: Money,
        use: z.enum(FLEET_USES).default("private"),
        driver_name: opt(120),
      })
      .parse(Object.fromEntries(fd));
    const row = await addVehicle(c, v.orgId, v);
    refresh();
    return { ok: true, message: `${row.registration} added to your fleet.` };
  });
}

export async function removeVehicleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    await removeVehicle(c, uuid.parse(fd.get("vehicleId")));
    refresh();
    return { ok: true, message: "Vehicle removed from the fleet." };
  });
}

export async function importFleetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const orgId = uuid.parse(fd.get("orgId"));
    const mode = fd.get("mode") === "import" ? "import" : "preview";
    const r = await importFleet(c, orgId, await readCsv(fd), { mode });
    if (mode === "import") refresh();
    return {
      ok: true,
      message:
        mode === "preview"
          ? r.valid ? `${r.valid} vehicle${r.valid === 1 ? "" : "s"} ready to import, ${r.errors.length} with problems. Review below, then import.` : "No valid rows found. Fix the problems below and try again."
          : `Imported ${r.inserted} vehicle${r.inserted === 1 ? "" : "s"}. ${r.errors.length} row${r.errors.length === 1 ? "" : "s"} not imported.`,
      data: { mode, valid: r.valid, inserted: r.inserted, errors: JSON.stringify(r.errors), preview: JSON.stringify(r.preview) },
    };
  });
}

export async function requestFleetQuoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z
      .object({
        orgId: uuid,
        coverType: z.enum(["comprehensive", "third_party_fire_theft", "third_party"]).default("comprehensive"),
        region: z.enum(GHANA_REGIONS as unknown as [string, ...string[]]).optional().or(z.literal("").transform(() => undefined)),
        notes: opt(1000),
      })
      .parse(Object.fromEntries(fd));
    const ids = fd.getAll("vehicleId").map(String).filter((x) => uuid.safeParse(x).success);
    const r = await requestFleetQuote(c, v.orgId, ids.length ? ids : null, { coverType: v.coverType, region: v.region ?? null, notes: v.notes });
    refresh();
    return { ok: true, message: `Fleet request ${r.reference} sent for ${r.vehicles} vehicle${r.vehicles === 1 ? "" : "s"}. A licensed broker will prepare quotes.`, data: { requestId: r.requestId } };
  });
}

export async function addAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z.object({ orgId: uuid, kind: z.enum(ASSET_KINDS), description: z.string().trim().min(2, "Describe the asset").max(300), address: opt(300), value: Money }).parse(Object.fromEntries(fd));
    await addAsset(c, v.orgId, v);
    refresh();
    return { ok: true, message: "Asset added." };
  });
}

export async function removeAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    await removeAsset(c, uuid.parse(fd.get("assetId")));
    refresh();
    return { ok: true, message: "Asset removed." };
  });
}

export async function requestPropertyQuoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const raw = Object.fromEntries(fd) as Record<string, string>;
    const v = z.object({ orgId: uuid, categorySlug: z.enum(["sme-property", "liability"]) }).parse(raw);
    const details: Record<string, unknown> = {};
    for (const k of ["region", "business_type", "premises_value", "stock_value", "equipment_value", "employees", "liability_type", "profession", "annual_turnover", "limit_of_indemnity"]) {
      if (raw[k]) details[k] = raw[k];
    }
    if (v.categorySlug === "sme-property") details.business_interruption = raw.business_interruption === "on";
    else details.prior_claims = raw.prior_claims === "on";
    const r = await requestPropertyQuote(c, v.orgId, { categorySlug: v.categorySlug, details });
    refresh();
    return { ok: true, message: `Request ${r.reference} sent. A licensed broker reviews it before insurers are approached.`, data: { requestId: r.requestId } };
  });
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------
export async function payInvoiceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z
      .object({
        invoiceId: uuid,
        insurerOrgId: uuid.optional().or(z.literal("").transform(() => undefined)),
        channel: z.enum(["mobile_money", "card", "bank_transfer"]),
        phone: opt(20),
        network: z.enum(["mtn", "vod", "atl"]).optional().or(z.literal("").transform(() => undefined)),
      })
      .parse(Object.fromEntries(fd));
    if (v.channel === "mobile_money" && (!v.phone || !v.network)) return { ok: false, error: "Enter the mobile money number and network." };
    const r = await payInvoice(c, v.invoiceId, { channel: v.channel, insurerOrgId: v.insurerOrgId ?? null, momo: v.channel === "mobile_money" ? { phone: v.phone!, provider: v.network! } : null, callbackUrl: undefined });
    refresh();
    const started = r.results.filter((x) => x.paymentId);
    const link = started.find((x) => x.authorizationUrl)?.authorizationUrl ?? "";
    const notes = r.results.filter((x) => !x.paymentId).map((x) => `${x.insurerName ?? "Insurer"}: ${x.message ?? x.status}`);
    return {
      ok: started.length > 0,
      ...(started.length ? { message: `${started.length} payment${started.length === 1 ? "" : "s"} started — each goes straight to the insurer.${link ? " Complete checkout with the link below." : ""}${notes.length ? ` ${notes.join(" ")}` : ""}` } : { error: notes.join(" ") || "No payment could be started." }),
      data: { checkout: link },
    };
  });
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
export async function inviteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z.object({ orgId: uuid, email: z.string().trim().toLowerCase().email("Enter a valid email"), role: z.enum(BUSINESS_ROLES, { error: "Choose a role" }), team: opt(60) }).parse(Object.fromEntries(fd));
    const r = await inviteBusinessUser(c, v.orgId, { email: v.email, role: v.role, team: v.team ?? null });
    refresh();
    return { ok: true, message: `Invitation emailed to ${v.email}. It expires in 14 days — you can also share the link: ${r.link}` };
  });
}

export async function updateTeamMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return run(async (c) => {
    const v = z.object({ orgId: uuid, membershipId: uuid, role: z.enum(BUSINESS_ROLES).optional(), op: z.enum(["role", "deactivate", "reactivate"]) }).parse(Object.fromEntries(fd));
    await updateTeamMember(c, v.orgId, v.membershipId, v.op === "role" ? { role: v.role } : { active: v.op === "reactivate" });
    refresh();
    return { ok: true, message: v.op === "role" ? "Role updated." : v.op === "deactivate" ? "Access removed." : "Access restored." };
  });
}
