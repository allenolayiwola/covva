import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CONSENT_CODE_TTL_MINUTES,
  CONSENT_KINDS,
  beneficiarySchema,
  canFileProxyClaim,
  consentMessage,
  familyDashboardSummary,
  giftMessageSchema,
  maskGhanaCard,
  type BeneficiaryInput,
  type ConsentKind,
  type ConsentRecord,
  type FamilyDashboardSummary,
  type GiftInput,
} from "@im/core";
import type { Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserClient } from "@/server/api-auth";
import { BusinessRuleError, ruleMessage } from "@/server/requests";
import { notify, sendSms } from "@/server/notify";
import { log, mask } from "@/server/log";

/**
 * Diaspora: sponsors abroad, beneficiaries in Ghana, consent by OTP / signed link, sponsorships,
 * gifts and the family dashboard. Reads go through the caller's RLS client; the service client is
 * used only for system writes (issuing consent codes, link decisions, account linking).
 */
type Svc = ReturnType<typeof createServiceClient>;
type Db = UserClient;

export type Beneficiary = Row<"beneficiaries">;
export type Sponsorship = Row<"sponsorships">;
export type BeneficiaryConsent = Row<"beneficiary_consents">;

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_ENV === "production" ? "https://covva.com.gh" : "http://localhost:3000")).replace(/\/$/, "");

/** Columns safe to send to the sponsor's UI/API (the Ghana Card is masked). */
export const BENEFICIARY_COLS = "id, sponsor_user_id, household_id, full_name, relationship, phone, email, date_of_birth, ghana_card_number, address, region, linked_user_id, consent_status, consent_channel, consent_sent_at, consent_granted_at, consent_expires_at, notes, created_at, updated_at";

export type BeneficiaryView = Omit<Beneficiary, "ghana_card_number" | "consent_code_hash"> & { ghana_card_masked: string | null; has_account: boolean };

export function toBeneficiaryView(b: Beneficiary | Omit<Beneficiary, "consent_code_hash">): BeneficiaryView {
  const { ghana_card_number, ...rest } = b as Beneficiary;
  const view = { ...rest } as Record<string, unknown>;
  delete view.consent_code_hash;
  return { ...(view as Omit<Beneficiary, "ghana_card_number" | "consent_code_hash">), ghana_card_masked: maskGhanaCard(ghana_card_number), has_account: !!b.linked_user_id };
}

function fail(err: { code?: string; message?: string } | null, fallback: string): never {
  throw new BusinessRuleError(ruleMessage(err, fallback), err?.code === "42501" ? "forbidden" : "business_rule");
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------
/** The sponsor's household (one per owner; created on first use). */
export async function ensureHousehold(db: Db, userId: string, name?: string | null): Promise<{ id: string; name: string }> {
  const { data: existing } = await db.from("households").select("id, name").eq("owner_user_id", userId).maybeSingle();
  if (existing) return existing;
  const { data, error } = await db.from("households").insert({ owner_user_id: userId, name: name?.trim() || "My family" }).select("id, name").single();
  if (error || !data) {
    // Lost a race with a concurrent insert: read it back.
    const { data: again } = await db.from("households").select("id, name").eq("owner_user_id", userId).maybeSingle();
    if (again) return again;
    fail(error, "We couldn't set up your family group.");
  }
  await db.from("household_members").insert({ household_id: data.id, user_id: userId, role: "owner" });
  return data;
}

// ---------------------------------------------------------------------------
// Beneficiaries
// ---------------------------------------------------------------------------
export async function listBeneficiaries(db: Db, userId: string): Promise<BeneficiaryView[]> {
  const { data, error } = await db.from("beneficiaries").select(BENEFICIARY_COLS).eq("sponsor_user_id", userId).order("created_at", { ascending: true });
  if (error) fail(error, "We couldn't load your family members.");
  return (data ?? []).map((b) => toBeneficiaryView(b as Beneficiary));
}

export async function getBeneficiary(db: Db, userId: string, id: string): Promise<BeneficiaryView | null> {
  const { data } = await db.from("beneficiaries").select(BENEFICIARY_COLS).eq("id", id).eq("sponsor_user_id", userId).maybeSingle();
  return data ? toBeneficiaryView(data as Beneficiary) : null;
}

/**
 * Add a family member. Validates with `beneficiarySchema` (Ghana phone → E.164), files them in the
 * sponsor's household and marks the sponsor as a sponsor. Consent starts `pending` (DB guard).
 */
export async function createBeneficiary(db: Db, userId: string, raw: unknown): Promise<BeneficiaryView> {
  const parsed = beneficiarySchema.safeParse(raw);
  if (!parsed.success) throw new BusinessRuleError(parsed.error.issues[0]?.message ?? "Please check the details.", "invalid_input");
  const v = parsed.data;
  const household = await ensureHousehold(db, userId);
  const { data: existing } = await db.from("beneficiaries").select("id").eq("sponsor_user_id", userId).eq("phone", v.phone).maybeSingle();
  if (existing) throw new BusinessRuleError("You have already added a family member with that phone number.", "conflict");
  const { data, error } = await db
    .from("beneficiaries")
    .insert({
      sponsor_user_id: userId,
      household_id: household.id,
      full_name: v.fullName,
      relationship: v.relationship,
      phone: v.phone,
      email: v.email ?? null,
      date_of_birth: v.dateOfBirth ?? null,
      ghana_card_number: v.ghanaCardNumber ?? null,
      address: v.address ?? null,
      region: v.region ?? null,
      notes: v.notes ?? null,
    })
    .select(BENEFICIARY_COLS)
    .single();
  if (error || !data) fail(error, "We couldn't add that family member.");
  await db.from("household_members").insert({ household_id: household.id, beneficiary_id: data.id, role: "member" });
  // Anyone who looks after family on Covva is a sponsor, wherever they live.
  await db.from("profiles").update({ is_sponsor: true }).eq("id", userId).eq("is_sponsor", false);
  return toBeneficiaryView(data as Beneficiary);
}

export async function updateBeneficiary(db: Db, userId: string, id: string, raw: Partial<BeneficiaryInput> & Record<string, unknown>): Promise<BeneficiaryView> {
  const current = await db.from("beneficiaries").select(BENEFICIARY_COLS).eq("id", id).eq("sponsor_user_id", userId).maybeSingle();
  if (!current.data) throw new BusinessRuleError("Family member not found.", "not_found");
  const parsed = beneficiarySchema.partial().safeParse(raw);
  if (!parsed.success) throw new BusinessRuleError(parsed.error.issues[0]?.message ?? "Please check the details.", "invalid_input");
  const v = parsed.data;
  const patch: Partial<Beneficiary> = {};
  if (v.fullName !== undefined) patch.full_name = v.fullName;
  if (v.relationship !== undefined) patch.relationship = v.relationship;
  if (v.phone !== undefined) patch.phone = v.phone;
  if ("email" in raw) patch.email = v.email ?? null;
  if ("dateOfBirth" in raw) patch.date_of_birth = v.dateOfBirth ?? null;
  if ("ghanaCardNumber" in raw && raw.ghanaCardNumber !== undefined) patch.ghana_card_number = v.ghanaCardNumber ?? null;
  if ("address" in raw) patch.address = v.address ?? null;
  if ("region" in raw) patch.region = v.region ?? null;
  if ("notes" in raw) patch.notes = v.notes ?? null;
  if (!Object.keys(patch).length) return toBeneficiaryView(current.data as Beneficiary);
  const { data, error } = await db.from("beneficiaries").update(patch).eq("id", id).eq("sponsor_user_id", userId).select(BENEFICIARY_COLS).single();
  if (error || !data) fail(error, "We couldn't save those changes.");
  return toBeneficiaryView(data as Beneficiary);
}

export async function listConsents(db: Db, beneficiaryId: string): Promise<BeneficiaryConsent[]> {
  const { data } = await db.from("beneficiary_consents").select("*").eq("beneficiary_id", beneficiaryId);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Consent: OTP codes and signed links
// ---------------------------------------------------------------------------
function linkSecret(): string {
  const s = process.env.CONSENT_LINK_SECRET ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("CONSENT_LINK_SECRET is not configured");
    return "dev-consent-link-secret";
  }
  return s;
}

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** `<base64url(beneficiaryId.kind.expiresAt)>.<hmac>` — self-contained, verified without a lookup. */
export function consentLinkToken(beneficiaryId: string, kind: ConsentKind, expiresAt: Date): string {
  const payload = b64u(`${beneficiaryId}.${kind}.${expiresAt.getTime()}`);
  const sig = createHmac("sha256", linkSecret()).update(payload).digest("base64url").slice(0, 43);
  return `${payload}.${sig}`;
}

export function verifyConsentLinkToken(token: string | null | undefined): { beneficiaryId: string; kind: ConsentKind; expiresAt: Date } | null {
  if (!token || token.length > 400) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", linkSecret()).update(payload).digest("base64url").slice(0, 43);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [beneficiaryId, kind, exp] = decoded.split(".");
  if (!beneficiaryId || !kind || !exp || !/^[0-9a-f-]{36}$/i.test(beneficiaryId) || !(CONSENT_KINDS as readonly string[]).includes(kind)) return null;
  const expiresAt = new Date(Number(exp));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) return null;
  return { beneficiaryId, kind: kind as ConsentKind, expiresAt };
}

export function consentLinkUrl(token: string): string {
  return `${siteUrl()}/consent/${encodeURIComponent(token)}`;
}

export interface SendConsentResult {
  beneficiaryId: string;
  kind: ConsentKind;
  channel: "sms" | "whatsapp";
  /** Masked phone the code went to. */
  sentTo: string;
  expiresAt: string;
  delivered: boolean;
  provider?: string;
}

/**
 * Issue a consent code to the beneficiary. The caller must be the sponsor (verified through an RLS
 * read of the beneficiary with `db`); the code itself comes from the service-role RPC and is sent to
 * the beneficiary's phone — never returned to the sponsor. Links are valid for 7 days, codes 15 min.
 */
export async function sendConsentCode(db: Db, userId: string, beneficiaryId: string, kind: ConsentKind, channel: "sms" | "whatsapp" = "sms"): Promise<SendConsentResult> {
  const { data: b } = await db.from("beneficiaries").select("id, full_name, phone, consent_status, sponsor_user_id").eq("id", beneficiaryId).eq("sponsor_user_id", userId).maybeSingle();
  if (!b) throw new BusinessRuleError("Family member not found.", "not_found");
  const { data: sponsor } = await db.from("profiles").select("full_name, preferred_name").eq("id", userId).maybeSingle();
  const sponsorName = sponsor?.preferred_name || sponsor?.full_name?.split(/\s+/)[0] || "Your family member";

  const svc = createServiceClient();
  const { data: code, error } = await svc.rpc("request_beneficiary_consent", { p_beneficiary_id: b.id, p_kind: kind, p_channel: channel });
  if (error || !code) fail(error, "We couldn't create a consent code just now.");

  const linkExpiry = new Date(Date.now() + 7 * 86_400_000);
  const link = consentLinkUrl(consentLinkToken(b.id, kind, linkExpiry));
  const text = consentMessage({ sponsorName, beneficiaryName: b.full_name, kind, code, link });
  const expiresAt = new Date(Date.now() + CONSENT_CODE_TTL_MINUTES * 60_000).toISOString();

  let delivered = false;
  let provider: string | undefined;
  if (channel === "whatsapp") {
    try {
      const { sendWhatsApp, whatsAppLive } = await import("@/server/providers/whatsapp");
      const r = await sendWhatsApp({ to: b.phone, kind: "consent.request", title: `${sponsorName} is asking for your consent on Covva`, body: text, link });
      provider = r.provider;
      delivered = r.ok && r.provider === "meta" && whatsAppLive();
    } catch (err) {
      log.warn("diaspora.consent.whatsapp_failed", { err });
    }
  }
  if (!delivered) {
    const r = await sendSms(b.phone, text);
    delivered = r.ok === true;
    provider = String(r.provider ?? provider ?? "sms");
  }
  log.info("diaspora.consent.sent", { beneficiaryId: b.id, kind, channel, to: mask(b.phone), delivered, provider });
  return { beneficiaryId: b.id, kind, channel, sentTo: mask(b.phone) ?? "", expiresAt, delivered, provider };
}

/** The sponsor (or the beneficiary's own account) enters the code the beneficiary read out. */
export async function confirmConsent(db: Db, beneficiaryId: string, kind: ConsentKind, code: string): Promise<{ status: "granted"; grantedAt: string | null }> {
  const { data, error } = await db.rpc("confirm_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: kind, p_code: code.replace(/\D/g, "") });
  if (error) fail(error, "We couldn't confirm that code.");
  const r = (data ?? {}) as { status?: string; granted_at?: string | null };
  return { status: "granted", grantedAt: r.granted_at ?? null };
}

/** What the public consent page shows: who is asking and what will be shared. */
export async function consentLinkContext(token: string | null | undefined) {
  const t = verifyConsentLinkToken(token);
  if (!t) return null;
  const svc = createServiceClient();
  const { data: b } = await svc.from("beneficiaries").select("id, full_name, relationship, sponsor_user_id, consent_status").eq("id", t.beneficiaryId).maybeSingle();
  if (!b) return null;
  const [{ data: sponsor }, { data: consent }] = await Promise.all([
    svc.from("profiles").select("full_name, preferred_name, country_code").eq("id", b.sponsor_user_id).maybeSingle(),
    svc.from("beneficiary_consents").select("granted, granted_at, declined_at").eq("beneficiary_id", b.id).eq("kind", t.kind).maybeSingle(),
  ]);
  return {
    beneficiaryId: b.id,
    kind: t.kind,
    beneficiaryFirstName: b.full_name.split(/\s+/)[0] ?? b.full_name,
    sponsorName: sponsor?.preferred_name || sponsor?.full_name || "A family member",
    sponsorCountry: sponsor?.country_code ?? null,
    relationship: b.relationship,
    decided: consent?.granted ? ("granted" as const) : consent?.declined_at ? ("declined" as const) : null,
    expiresAt: t.expiresAt.toISOString(),
  };
}

/** Accept / decline from the signed link (no login). Verifies the token, then records the decision with the service role. */
export async function decideConsentViaLink(token: string, granted: boolean): Promise<{ status: "granted" | "declined" }> {
  const t = verifyConsentLinkToken(token);
  if (!t) throw new BusinessRuleError("This link has expired or is not valid. Ask your family member to send a new one.", "invalid_input");
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("decide_beneficiary_consent_link", { p_beneficiary_id: t.beneficiaryId, p_kind: t.kind, p_granted: granted });
  if (error) fail(error, "We couldn't record your decision.");
  const status = ((data as { status?: string } | null)?.status === "granted" ? "granted" : "declined") as "granted" | "declined";
  // Tell the sponsor.
  const { data: b } = await svc.from("beneficiaries").select("id, full_name, sponsor_user_id").eq("id", t.beneficiaryId).maybeSingle();
  if (b) {
    await notify({
      userId: b.sponsor_user_id,
      kind: status === "granted" ? "consent.granted" : "consent.declined",
      title: status === "granted" ? `${b.full_name} gave consent` : `${b.full_name} declined`,
      body: status === "granted" ? "You can now request cover for them." : "They declined to have cover arranged through Covva. Talk to them and send a new request if they change their mind.",
      link: `/account/family/beneficiaries/${b.id}`,
      data: { beneficiary_id: b.id, kind: t.kind },
      channels: ["in_app", "push", "email"],
    });
  }
  return { status };
}

/**
 * First sign-in hook: link beneficiary records that carry this user's phone number (the database
 * trigger does this on profile insert/phone change; this covers users who existed before the trigger).
 */
export async function linkBeneficiaryAccount(userId: string): Promise<{ linked: number }> {
  const svc = createServiceClient();
  const { data: p } = await svc.from("profiles").select("phone").eq("id", userId).maybeSingle();
  const digits = (p?.phone ?? "").replace(/\D/g, "");
  if (digits.length < 9) return { linked: 0 };
  const { data: candidates } = await svc.from("beneficiaries").select("id, phone").is("linked_user_id", null).neq("sponsor_user_id", userId).like("phone", `%${digits.slice(-9)}`);
  const ids = (candidates ?? []).filter((c) => c.phone.replace(/\D/g, "") === digits).map((c) => c.id);
  if (!ids.length) return { linked: 0 };
  const { error } = await svc.from("beneficiaries").update({ linked_user_id: userId }).in("id", ids);
  if (error) log.warn("diaspora.link_failed", { userId, err: error });
  return { linked: error ? 0 : ids.length };
}

// ---------------------------------------------------------------------------
// Sponsorships and gifts
// ---------------------------------------------------------------------------
export interface CreateSponsorshipArgs extends Partial<GiftInput> {
  beneficiaryId: string;
  requestId?: string | null;
  policyId?: string | null;
}

/** Link the payer to a beneficiary and the request/policy; becomes active when the policy exists. */
export async function createSponsorship(db: Db, userId: string, args: CreateSponsorshipArgs): Promise<Sponsorship> {
  const gift = giftMessageSchema.safeParse({ gift: args.gift ?? false, giftMessage: args.giftMessage, notifyBeneficiary: args.notifyBeneficiary ?? true });
  if (!gift.success) throw new BusinessRuleError(gift.error.issues[0]?.message ?? "Check the gift message.", "invalid_input");
  const { data: b } = await db.from("beneficiaries").select("id, consent_status").eq("id", args.beneficiaryId).eq("sponsor_user_id", userId).maybeSingle();
  if (!b) throw new BusinessRuleError("Family member not found.", "not_found");
  if (b.consent_status !== "granted") throw new BusinessRuleError("Your family member needs to give consent before cover can be arranged for them.", "business_rule");
  const { data, error } = await db
    .from("sponsorships")
    .insert({
      sponsor_user_id: userId,
      beneficiary_id: b.id,
      request_id: args.requestId ?? null,
      policy_id: args.policyId ?? null,
      gift: gift.data.gift,
      gift_message: gift.data.gift ? gift.data.giftMessage ?? null : null,
      notify_beneficiary: gift.data.notifyBeneficiary,
    })
    .select("*")
    .single();
  if (error?.code === "23505") throw new BusinessRuleError("This policy already has a sponsorship.", "conflict");
  if (error || !data) fail(error, "We couldn't save the sponsorship.");
  if (data.policy_id) {
    // Policy already exists (e.g. sponsorship added after purchase): stamp the sponsor/beneficiary on it.
    const svc = createServiceClient();
    await svc.from("policies").update({ sponsor_user_id: userId, beneficiary_id: b.id }).eq("id", data.policy_id).is("sponsor_user_id", null);
  }
  return data;
}

export async function updateSponsorship(db: Db, userId: string, id: string, patch: Partial<GiftInput>): Promise<Sponsorship> {
  const gift = giftMessageSchema.partial().safeParse(patch);
  if (!gift.success) throw new BusinessRuleError(gift.error.issues[0]?.message ?? "Check the gift message.", "invalid_input");
  const update: Partial<Sponsorship> = {};
  if (gift.data.gift !== undefined) update.gift = gift.data.gift;
  if ("giftMessage" in patch) update.gift_message = gift.data.giftMessage ?? null;
  if (gift.data.notifyBeneficiary !== undefined) update.notify_beneficiary = gift.data.notifyBeneficiary;
  const { data, error } = await db.from("sponsorships").update(update).eq("id", id).eq("sponsor_user_id", userId).select("*").single();
  if (error || !data) fail(error, "We couldn't update the sponsorship.");
  return data;
}

/** The beneficiary (linked account) opens the gift; records `gift_revealed_at` and returns the message. */
export async function revealGift(db: Db, sponsorshipId: string): Promise<{ id: string; giftMessage: string | null; giftRevealedAt: string | null; policyId: string | null }> {
  const { data, error } = await db.rpc("reveal_gift", { p_sponsorship_id: sponsorshipId });
  if (error) fail(error, "We couldn't open that gift.");
  const r = (data ?? {}) as { id: string; gift_message: string | null; gift_revealed_at: string | null; policy_id: string | null };
  return { id: r.id, giftMessage: r.gift_message, giftRevealedAt: r.gift_revealed_at, policyId: r.policy_id };
}

/** Sponsor hands the gift over: the beneficiary is told (SMS/WhatsApp or in-app) and gets the reveal link. */
export async function sendGiftNotice(db: Db, userId: string, sponsorshipId: string): Promise<{ sent: boolean }> {
  const { data: s } = await db.from("sponsorships").select("id, gift, policy_id, beneficiary_id").eq("id", sponsorshipId).eq("sponsor_user_id", userId).maybeSingle();
  if (!s || !s.gift || !s.policy_id) throw new BusinessRuleError("The gift can be handed over once the policy is issued.", "business_rule");
  const { notifyPolicyParties } = await import("@/server/diaspora-notify");
  const r = await notifyPolicyParties(s.policy_id, "gift.received", {
    title: "You have been given insurance cover",
    body: "Someone who cares about you has arranged cover for you through Covva. Open it to read their message and see your policy.",
    link: `/account/gifts/${s.id}`,
    skipUserIds: [userId],
  });
  return { sent: r.beneficiary.delivered !== "skipped" };
}

// ---------------------------------------------------------------------------
// Family dashboard
// ---------------------------------------------------------------------------
export interface FamilyDashboard {
  summary: FamilyDashboardSummary;
  beneficiaries: (BeneficiaryView & { consents: Pick<BeneficiaryConsent, "kind" | "granted" | "granted_at" | "declined_at" | "expires_at" | "requested_at" | "locked_at">[] })[];
  sponsorships: Sponsorship[];
  policies: PolicyLite[];
  claims: ClaimLite[];
  payments: PaymentLite[];
  /** Recurring sponsor payments (payments stream) — empty when the table is not deployed. */
  subscriptions: SubscriptionLite[];
}

export type PolicyLite = Pick<Row<"policies">, "id" | "internal_reference" | "policy_number" | "status" | "nickname" | "summary" | "cover_start" | "cover_end" | "premium" | "currency" | "billing_period" | "sponsor_user_id" | "beneficiary_id" | "customer_id" | "request_id"> & {
  category: { id: string; slug: string; name: string; icon: string | null } | null;
  insurer: { id: string; name: string; logo_url: string | null } | null;
};
export type ClaimLite = Pick<Row<"claims">, "id" | "reference" | "status" | "incident_type" | "policy_id" | "reported_at" | "created_at" | "reported_by_user_id">;
export type PaymentLite = Pick<Row<"payments">, "id" | "status" | "amount" | "currency" | "policy_id" | "request_id" | "paid_at" | "created_at" | "channel">;
export interface SubscriptionLite {
  id: string;
  status: string;
  cadence: string;
  display_amount: number;
  display_currency: string;
  ghs_amount: number;
  next_charge_at: string;
  policy_id: string | null;
  beneficiary_id: string | null;
}

const POLICY_LITE = "id, internal_reference, policy_number, status, nickname, summary, cover_start, cover_end, premium, currency, billing_period, sponsor_user_id, beneficiary_id, customer_id, request_id, category:product_categories(id, slug, name, icon), insurer:organizations!policies_insurer_org_id_fkey(id, name, logo_url)";

/** Everything the sponsor pays for: beneficiaries (+ consents), sponsorships, policies, renewals, payment schedule, claims. */
export async function familyDashboard(db: Db, userId: string): Promise<FamilyDashboard> {
  const beneficiaries = await listBeneficiaries(db, userId);
  const beneficiaryIds = beneficiaries.map((b) => b.id);
  const [consentsRes, sponsorshipsRes, policiesRes] = await Promise.all([
    beneficiaryIds.length ? db.from("beneficiary_consents").select("beneficiary_id, kind, granted, granted_at, declined_at, expires_at, requested_at, locked_at").in("beneficiary_id", beneficiaryIds) : Promise.resolve({ data: [] as { beneficiary_id: string; kind: string; granted: boolean; granted_at: string | null; declined_at: string | null; expires_at: string | null; requested_at: string | null; locked_at: string | null }[] }),
    db.from("sponsorships").select("*").eq("sponsor_user_id", userId).order("created_at", { ascending: false }),
    db.from("policies").select(POLICY_LITE).or(`sponsor_user_id.eq.${userId}${beneficiaryIds.length ? `,beneficiary_id.in.(${beneficiaryIds.join(",")})` : ""}`).order("cover_end", { ascending: true, nullsFirst: false }),
  ]);
  const policies = (policiesRes.data ?? []) as unknown as PolicyLite[];
  const policyIds = policies.map((p) => p.id);
  const [claimsRes, paymentsRes, subscriptions] = await Promise.all([
    policyIds.length ? db.from("claims").select("id, reference, status, incident_type, policy_id, reported_at, created_at, reported_by_user_id").in("policy_id", policyIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as ClaimLite[] }),
    policyIds.length
      ? db.from("payments").select("id, status, amount, currency, policy_id, request_id, paid_at, created_at, channel").or(`policy_id.in.(${policyIds.join(",")}),customer_id.eq.${userId}`).order("created_at", { ascending: false }).limit(100)
      : db.from("payments").select("id, status, amount, currency, policy_id, request_id, paid_at, created_at, channel").eq("customer_id", userId).order("created_at", { ascending: false }).limit(100),
    loadSponsorSubscriptions(db, userId),
  ]);
  const consents = consentsRes.data ?? [];
  const claims = (claimsRes.data ?? []) as ClaimLite[];
  const payments = (paymentsRes.data ?? []) as PaymentLite[];

  const summary = familyDashboardSummary(
    policies.map((p) => ({ id: p.id, status: p.status, cover_end: p.cover_end, premium: p.premium, currency: p.currency, billing_period: p.billing_period, beneficiary_id: p.beneficiary_id, category_slug: p.category?.slug ?? null })),
    claims.map((c) => ({ id: c.id, status: c.status, policy_id: c.policy_id })),
    [
      ...payments.map((p) => ({ id: p.id, status: p.status, amount: p.amount, currency: p.currency, policy_id: p.policy_id, paid_at: p.paid_at, due_at: null })),
      ...subscriptions.filter((s) => ["active", "past_due", "trialing"].includes(s.status)).map((s) => ({ id: s.id, status: "scheduled", amount: s.display_amount, currency: s.display_currency, policy_id: s.policy_id, due_at: s.next_charge_at, paid_at: null })),
    ],
    beneficiaries.map((b) => ({ id: b.id, full_name: b.full_name, consent_status: b.consent_status })),
  );

  return {
    summary,
    beneficiaries: beneficiaries.map((b) => ({ ...b, consents: consents.filter((c) => c.beneficiary_id === b.id).map(({ beneficiary_id: _b, ...rest }) => rest) })),
    sponsorships: sponsorshipsRes.data ?? [],
    policies,
    claims,
    payments,
    subscriptions,
  };
}

/** Recurring sponsor payments live in the payments stream's `sponsor_subscriptions`; tolerate its absence. */
async function loadSponsorSubscriptions(db: Db, userId: string): Promise<SubscriptionLite[]> {
  try {
    const { data, error } = await db
      .from("sponsor_subscriptions")
      .select("id, status, cadence, display_amount, display_currency, ghs_amount, next_charge_at, policy_id, beneficiary_id")
      .eq("sponsor_user_id", userId)
      .order("next_charge_at", { ascending: true });
    if (error) return [];
    return (data ?? []) as SubscriptionLite[];
  } catch {
    return [];
  }
}

/** Proxy-claim eligibility for a policy the sponsor pays for (used by the UI to show/hide the button). */
export async function proxyClaimEligibility(db: Db, userId: string, policyId: string) {
  const { data: s } = await db.from("sponsorships").select("id, status, policy_id, beneficiary_id").eq("policy_id", policyId).eq("sponsor_user_id", userId).maybeSingle();
  const consents: ConsentRecord[] = s ? await listConsents(db, s.beneficiary_id) : [];
  return { sponsorship: s, consents, check: canFileProxyClaim(s, consents) };
}
