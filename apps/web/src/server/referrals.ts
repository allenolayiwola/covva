import "server-only";
import { cookies } from "next/headers";
import {
  EMBED_DISCLOSURE,
  REFERRAL_COOKIE,
  decodeReferralCookie,
  normaliseRewardConditions,
  parseReferralParam,
  referralCode,
  rewardFor,
  type LinkOwnerKind,
  type RatingRule,
  type RewardRule,
  type RiskField,
} from "@im/core";
import type { Json, Row } from "@im/db";
import { createPublicClient, createServiceClient } from "@/lib/supabase/server";
import { evaluateUnderwriting, quoteVersion } from "@/server/catalogue";
import { log } from "@/server/log";
import { emailHtml, sendEmail, sendSms } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";

/**
 * Referrals and embedded distribution (Phase 3).
 *
 *   capture      `?ref=CODE` on any page → first-party `covva_ref` cookie (proxy.ts, 30 days)
 *   attribution  `recordAttribution()` when a request is created (one per request)
 *   conversion   `onPolicyActivated()` from `onPolicyIssued()` → converted_at + `referral.converted`
 *   rewards      `evaluateReferralRewards()` (cron `referral-rewards`, daily 04:00) after the holding
 *                period → reward_ledger rows per active rule; partner revenue share is a share of the
 *                policy's `platform_fee` ledger entries (Covva's fee), never of the premium.
 *
 * Writes use the service client: attributions and the reward ledger have no user write policies.
 * Nothing here may throw into the request/policy flows — failures are logged.
 */
type Svc = ReturnType<typeof createServiceClient>;

function svcOrNull(): Svc | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------
async function readTouch() {
  try {
    const jar = await cookies();
    return decodeReferralCookie(jar.get(REFERRAL_COOKIE)?.value);
  } catch {
    return null; // outside a request scope (cron, scripts)
  }
}

/**
 * Attribute a newly created request to the referral code in the `covva_ref` cookie (if any).
 * A partner-API lead touch (cookie carries the lead id) is completed instead of duplicated.
 * Self-referrals and disabled codes are refused by the database guard. Never throws.
 */
export async function recordAttribution(requestId: string, customerId: string): Promise<void> {
  try {
    const touch = await readTouch();
    if (!touch) return;
    const svc = svcOrNull();
    if (!svc) return;
    if (touch.leadId) {
      const { data: pending } = await svc
        .from("referral_attributions")
        .update({ request_id: requestId, customer_id: customerId })
        .eq("lead_id", touch.leadId)
        .eq("code", touch.code)
        .is("request_id", null)
        .select("id");
      if (pending?.length) return;
    }
    const { error } = await svc.from("referral_attributions").insert({
      code: touch.code,
      request_id: requestId,
      customer_id: customerId,
      source: touch.source,
      first_touch_at: new Date(touch.firstTouchAt).toISOString(),
      lead_id: touch.leadId ?? null,
    });
    if (error && error.code !== "23505") log.info("referrals.attribution_skipped", { requestId, code: touch.code, reason: error.message });
  } catch (err) {
    log.warn("referrals.attribution_failed", { requestId, err });
  }
}

/**
 * The attributed policy became active: mark the attribution converted and tell the partner.
 * Reward evaluation happens later (holding period) in the `referral-rewards` cron. Never throws.
 */
export async function onPolicyActivated(policyId: string): Promise<void> {
  try {
    const svc = svcOrNull();
    if (!svc) return;
    const { data: policy } = await svc.from("policies").select("id, request_id, status, category_id, issued_at").eq("id", policyId).maybeSingle();
    if (!policy?.request_id || policy.status !== "active") return;
    const { data: attr } = await svc
      .from("referral_attributions")
      .update({ policy_id: policy.id, converted_at: policy.issued_at ?? new Date().toISOString() })
      .eq("request_id", policy.request_id)
      .is("converted_at", null)
      .select("id, code, source, partner_org_id, converted_at")
      .maybeSingle();
    if (!attr) return;
    if (attr.partner_org_id) {
      const [{ data: request }, { data: category }] = await Promise.all([
        svc.from("requests").select("reference").eq("id", policy.request_id).maybeSingle(),
        svc.from("product_categories").select("slug").eq("id", policy.category_id).maybeSingle(),
      ]);
      await emitEvent(attr.partner_org_id, "referral.converted", {
        attribution_id: attr.id,
        code: attr.code,
        source: attr.source,
        request_id: policy.request_id,
        reference: request?.reference ?? null,
        policy_id: policy.id,
        category: category?.slug ?? null,
        converted_at: attr.converted_at,
      });
    }
  } catch (err) {
    log.warn("referrals.conversion_failed", { policyId, err });
  }
}

// ---------------------------------------------------------------------------
// Rewards (cron)
// ---------------------------------------------------------------------------
function toRule(r: Row<"reward_rules">): RewardRule {
  return { key: r.key, kind: r.kind as RewardRule["kind"], amount: Number(r.amount) || 0, conditions: normaliseRewardConditions(r.conditions), active: r.active, insurerOrgId: r.insurer_org_id };
}

/** Covva's net platform fee on a policy: `platform_fee` ledger entries less refund adjustments of them. */
export async function platformFeeForPolicy(svc: Svc, policyId: string): Promise<number> {
  const { data: payments } = await svc.from("payments").select("id").eq("policy_id", policyId);
  const paymentIds = (payments ?? []).map((p) => p.id);
  const filters = [`policy_id.eq.${policyId}`];
  if (paymentIds.length) filters.push(`payment_id.in.(${paymentIds.join(",")})`);
  const { data: rows } = await svc.from("ledger_entries").select("id, entry_type, org_id, counterparty_org_id, amount, reference").or(filters.join(","));
  const fees = (rows ?? []).filter((r) => r.entry_type === "platform_fee");
  if (!fees.length) return 0;
  const platform = new Set(fees.map((f) => f.org_id));
  const insurers = new Set(fees.map((f) => f.counterparty_org_id));
  // Refund reversals are `adjustment` rows between the same parties (see recordRefundLedger).
  const reversals = (rows ?? []).filter((r) => r.entry_type === "adjustment" && platform.has(r.org_id) && insurers.has(r.counterparty_org_id) && Number(r.amount) < 0);
  const total = fees.reduce((s, r) => s + Number(r.amount), 0) + reversals.reduce((s, r) => s + Number(r.amount), 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

/**
 * Daily: decide every converted attribution whose rewards are not settled yet. Idempotent —
 * reward_ledger.reference is unique (`ref:<attribution>:<recipient>:<rule>`), so a retried run
 * cannot double-post. Attributions stay open while any rule is still in its holding period.
 */
export async function evaluateReferralRewards(svc: Svc, now = new Date()): Promise<Record<string, unknown>> {
  const { data: ruleRows } = await svc.from("reward_rules").select("*").eq("active", true);
  const rules = (ruleRows ?? []).map(toRule);
  const { data: pending } = await svc
    .from("referral_attributions")
    .select("id, code, customer_id, policy_id, partner_org_id, converted_at, link:referral_links!referral_attributions_code_fkey(owner_kind, owner_user_id, owner_org_id)")
    .not("converted_at", "is", null)
    .is("rewards_evaluated_at", null)
    .order("converted_at", { ascending: true })
    .limit(200);
  let posted = 0;
  let settled = 0;
  let waiting = 0;
  for (const a of pending ?? []) {
    try {
      const link = a.link as unknown as { owner_kind: LinkOwnerKind; owner_user_id: string | null; owner_org_id: string | null } | null;
      if (!link || !a.policy_id) {
        await svc.from("referral_attributions").update({ rewards_evaluated_at: now.toISOString() }).eq("id", a.id);
        settled++;
        continue;
      }
      const { data: policy } = await svc
        .from("policies")
        .select("id, status, premium, insurer_org_id, issued_at, cover_start, customer_id, external_source, category:product_categories!policies_category_id_fkey(slug)")
        .eq("id", a.policy_id)
        .maybeSingle();
      if (!policy) continue;
      const { count: earlier } = await svc
        .from("policies")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", policy.customer_id)
        .eq("external_source", false)
        .neq("id", policy.id)
        .lt("issued_at", policy.issued_at ?? now.toISOString());
      let revenueSharePct: number | null = null;
      let platformFee: number | null = null;
      if (link.owner_kind !== "customer" && a.partner_org_id) {
        const { data: partner } = await svc.from("distribution_partners").select("revenue_share_pct, status").eq("org_id", a.partner_org_id).maybeSingle();
        revenueSharePct = partner && partner.status !== "suspended" ? Number(partner.revenue_share_pct) : 0;
        platformFee = await platformFeeForPolicy(svc, policy.id);
      }
      let anyPending = false;
      for (const rule of rules) {
        const decision = rewardFor(
          rule,
          {
            status: policy.status,
            premium: policy.premium,
            categorySlug: (policy.category as unknown as { slug?: string } | null)?.slug ?? null,
            insurerOrgId: policy.insurer_org_id,
            activatedAt: policy.issued_at ?? policy.cover_start,
            isFirstPolicy: (earlier ?? 0) === 0,
          },
          { ownerKind: link.owner_kind, convertedAt: a.converted_at, revenueSharePct, platformFee },
          now,
        );
        if (decision.status === "pending") {
          anyPending = true;
          continue;
        }
        if (decision.status !== "eligible") continue;
        for (const e of decision.entries) {
          const recipient = e.recipient === "referrer" ? { user_id: link.owner_user_id } : e.recipient === "friend" ? { user_id: a.customer_id } : { org_id: a.partner_org_id };
          if (!recipient.user_id && !("org_id" in recipient && recipient.org_id)) continue;
          const reference = `ref:${a.id}:${e.recipient}:${rule.key}`;
          const { error } = await svc.from("reward_ledger").insert({
            ...recipient,
            kind: e.kind,
            amount: e.amount,
            reference,
            rule_key: rule.key,
            related_policy_id: policy.id,
            related_attribution_id: a.id,
            expires_at: decision.expiresAt?.toISOString() ?? null,
            memo:
              e.kind === "partner_revenue_share"
                ? `${revenueSharePct}% of Covva's platform fee (GHS ${platformFee?.toFixed(2)}) — never the premium`
                : e.recipient === "friend"
                  ? "Welcome credit for joining through a referral (not cash)"
                  : "Referral credit: a friend's first policy stayed active through the holding period (not cash)",
          });
          if (error) {
            if (error.code !== "23505") log.error("referrals.reward_post_failed", { attributionId: a.id, reference, err: error });
            continue;
          }
          posted++;
          if (e.kind === "partner_revenue_share" && a.partner_org_id) {
            await emitEvent(a.partner_org_id, "referral.rewarded", { attribution_id: a.id, code: a.code, policy_id: policy.id, kind: e.kind, amount: e.amount, currency: "GHS" });
          }
        }
      }
      if (anyPending) waiting++;
      else {
        await svc.from("referral_attributions").update({ rewards_evaluated_at: now.toISOString() }).eq("id", a.id);
        settled++;
      }
    } catch (err) {
      log.error("referrals.evaluate_failed", { attributionId: a.id, err });
    }
  }
  return { checked: pending?.length ?? 0, posted, settled, waiting, rules: rules.length };
}

// ---------------------------------------------------------------------------
// Embedded widget + partner API
// ---------------------------------------------------------------------------
export interface EmbedPartner {
  orgId: string;
  orgName: string;
  code: string;
  segment: string;
  allowedCategories: string[];
  widgetDomains: string[];
  primaryColour: string | null;
  logoUrl: string | null;
}

/** Public widget config for an active distributor code (anon RPC). Null when unknown/inactive. */
export async function getEmbedPartner(codeParam: unknown): Promise<EmbedPartner | null> {
  const code = parseReferralParam(codeParam);
  if (!code) return null;
  const { data, error } = await createPublicClient().rpc("embed_partner", { p_code: code });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return null;
  return {
    orgId: row.org_id,
    orgName: row.org_name,
    code: row.code,
    segment: row.segment,
    allowedCategories: row.allowed_categories ?? [],
    widgetDomains: row.widget_domains ?? [],
    primaryColour: row.primary_colour,
    logoUrl: row.logo_url,
  };
}

/** The 3–5 rating-relevant fields the compact widget asks for, per category (others are asked on Covva). */
const EMBED_FIELD_KEYS: Record<string, string[]> = {
  motor: ["cover_type", "vehicle_value", "use", "vehicle_year", "driver_age"],
  travel: ["trip_days", "travellers", "oldest_traveller_age", "destination_region"],
  "personal-accident": ["sum_insured", "age", "occupation_class"],
  home: ["cover_scope", "building_value", "contents_value", "construction"],
  health: ["members", "oldest_member_age", "plan_level"],
  "life-funeral": ["plan_type", "sum_insured", "age", "smoker"],
  "sme-property": ["premises_value", "stock_value", "equipment_value", "employees"],
};

export function embedFieldsFor(slug: string, schema: RiskField[]): RiskField[] {
  const keys = EMBED_FIELD_KEYS[slug];
  const fields = keys ? keys.map((k) => schema.find((f) => f.key === k)).filter((f): f is RiskField => !!f) : [];
  if (fields.length) return fields;
  return schema.filter((f) => ["number", "currency", "select", "boolean"].includes(f.type)).slice(0, 4);
}

export interface IndicativeEstimate { insurerName: string; productName: string; premium: number }
export interface IndicativeResult {
  category: { slug: string; name: string };
  estimates: IndicativeEstimate[];
  range: { min: number; max: number } | null;
  insurersCompared: number;
  disclosure: string;
  note: string;
}

/**
 * Indicative annual estimates for a partial risk from every approved product in the category
 * (insurer-approved rating rules; nothing is stored, nothing is binding). Sorted by price only —
 * paid placements never influence the order.
 */
export async function indicativeEstimates(categorySlug: string, risk: Record<string, unknown>, allowedCategories: string[] = []): Promise<IndicativeResult | null> {
  const db = svcOrNull() ?? createPublicClient();
  const { data: category } = await db.from("product_categories").select("id, slug, name, availability").eq("slug", categorySlug).maybeSingle();
  if (!category || category.availability === "planned") return null;
  if (allowedCategories.length && !allowedCategories.includes(category.slug)) return null;
  const { data: products } = await db
    .from("products")
    .select("id, name, insurer_org_id, insurer:organizations!products_insurer_org_id_fkey(name, status), version:product_versions!products_current_version_fk(id, status, rating)")
    .eq("category_id", category.id)
    .eq("status", "approved");
  const estimates: IndicativeEstimate[] = [];
  for (const p of (products ?? []) as unknown as { name: string; insurer: { name: string; status: string } | null; version: { id: string; status: string; rating: unknown } | null }[]) {
    if (!p.version || p.version.status !== "approved" || p.insurer?.status !== "active") continue;
    try {
      const result = await quoteVersion(db as Svc, p.version.rating as RatingRule, risk);
      if (!result.ok || result.premium <= 0) continue;
      const uw = await evaluateUnderwriting(db as Svc, p.version.id, risk).catch(() => null);
      if (uw?.outcome === "decline") continue;
      estimates.push({ insurerName: p.insurer?.name ?? "Insurer", productName: p.name, premium: Math.round(result.premium) });
    } catch {
      /* a product that cannot price this partial risk is simply left out */
    }
  }
  estimates.sort((a, b) => a.premium - b.premium || a.insurerName.localeCompare(b.insurerName));
  return {
    category: { slug: category.slug, name: category.name },
    estimates,
    range: estimates.length ? { min: estimates[0]!.premium, max: estimates[estimates.length - 1]!.premium } : null,
    insurersCompared: new Set(estimates.map((e) => e.insurerName)).size,
    disclosure: EMBED_DISCLOSURE,
    note: "Indicative annual estimates from insurer-approved rates, sorted by price. Not a quote or an offer of cover: a licensed broker and the insurer confirm the final price after the full details. Paid placements never affect the order.",
  };
}

/** The partner's default widget code (oldest enabled distributor link), created on first use. */
export async function partnerDefaultCode(svc: Svc, orgId: string): Promise<string | null> {
  const { data } = await svc.from("referral_links").select("code").eq("owner_org_id", orgId).eq("owner_kind", "distributor").is("disabled_at", null).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (data?.code) return data.code;
  const { data: created, error } = await svc.rpc("create_partner_referral_link", { p_org_id: orgId, p_campaign: "widget", p_landing_path: "/", p_code: referralCode() });
  if (error) {
    log.warn("referrals.default_code_failed", { orgId, err: error });
    return null;
  }
  return (created as unknown as { code?: string } | null)?.code ?? null;
}

export interface DistributionLeadArgs {
  orgId: string;
  orgName: string;
  categorySlug: string;
  customer: { name: string; phone?: string; email?: string };
  risk: Record<string, unknown>;
  consent: { contact: true; capturedAt: string; method: string };
  code?: string;
  externalRef?: string;
  sendLink: "sms" | "email" | "both" | "none";
  siteUrl: string;
}

/**
 * Partner API hand-off: store the lead (with the partner's consent record), open a lead-only
 * attribution and send the customer a link to continue on Covva (sign-up/sign-in there; Covva
 * never collects payment through the partner). The link carries the code + lead id so the request
 * the customer creates completes this attribution.
 */
export async function createDistributionLead(svc: Svc, a: DistributionLeadArgs) {
  const { data: category } = await svc.from("product_categories").select("id, slug, name, availability").eq("slug", a.categorySlug).maybeSingle();
  if (!category || category.availability === "planned") return { error: "unknown_category" as const };
  const { data: partner } = await svc.from("distribution_partners").select("status, allowed_categories").eq("org_id", a.orgId).maybeSingle();
  if (!partner || partner.status !== "active") return { error: "partner_inactive" as const };
  if (partner.allowed_categories.length && !partner.allowed_categories.includes(category.slug)) return { error: "category_not_allowed" as const };

  let code = parseReferralParam(a.code);
  if (code) {
    const { data: link } = await svc.from("referral_links").select("code").eq("code", code).eq("owner_org_id", a.orgId).is("disabled_at", null).maybeSingle();
    if (!link) return { error: "unknown_code" as const };
  } else {
    code = await partnerDefaultCode(svc, a.orgId);
    if (!code) return { error: "no_code" as const };
  }

  const { data: lead, error } = await svc
    .from("leads")
    .insert({
      kind: "customer",
      name: a.customer.name,
      phone: a.customer.phone ?? null,
      email: a.customer.email ?? null,
      category_slug: category.slug,
      source_page: "distribution-api",
      tags: ["distribution", `partner:${a.orgId}`],
      message: `Referred by ${a.orgName} through the partner API.`,
      metadata: { partner_org_id: a.orgId, code, external_ref: a.externalRef ?? null, risk: a.risk, consent: a.consent } as unknown as Json,
    })
    .select("id")
    .single();
  if (error || !lead) throw error ?? new Error("lead insert failed");

  const { data: attribution, error: aErr } = await svc
    .from("referral_attributions")
    .insert({ code, lead_id: lead.id, source: "api", first_touch_at: new Date().toISOString() })
    .select("id")
    .single();
  if (aErr) throw aErr;

  const url = new URL("/get-started", a.siteUrl);
  url.searchParams.set("category", category.slug);
  url.searchParams.set("ref", code);
  url.searchParams.set("src", "api");
  url.searchParams.set("lead", lead.id);
  const continueUrl = url.toString();
  const first = a.customer.name.trim().split(/\s+/)[0];
  const sent: string[] = [];
  if ((a.sendLink === "sms" || a.sendLink === "both") && a.customer.phone) {
    await sendSms(a.customer.phone, `Hi ${first}, ${a.orgName} has passed your ${category.name.toLowerCase()} enquiry to Covva. Compare licensed insurers and continue here: ${continueUrl}`).catch(() => null);
    sent.push("sms");
  }
  if ((a.sendLink === "email" || a.sendLink === "both") && a.customer.email) {
    await sendEmail({
      to: a.customer.email,
      subject: `Continue your ${category.name.toLowerCase()} quote on Covva`,
      html: emailHtml({ title: `Continue your ${category.name.toLowerCase()} quote`, body: `${a.orgName} has passed your enquiry to Covva. Compare quotes from licensed insurers and continue when you are ready. ${EMBED_DISCLOSURE}`, link: continueUrl }, first),
    }).catch(() => null);
    sent.push("email");
  }
  return { leadId: lead.id, attributionId: attribution.id, code, continueUrl, sent };
}
