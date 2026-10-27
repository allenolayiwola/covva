import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  autoRenewDue,
  coverWindow,
  formatMoney,
  isMicroPeriod,
  microProducts,
  microQuoteText,
  PERIOD_LABEL,
  ratePremium,
  renewalStart,
  supportedPeriods,
  type MicroCoverPeriod,
  type MicroProductCard,
  type PolicyPeriod,
  type RatingRule,
  type RiskData,
} from "@im/core";
import type { Database, Enum, Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError, createRequest, ruleMessage } from "@/server/requests";
import { notify, notifyOrg } from "@/server/notify";
import { log } from "@/server/log";
import { quoteVersion } from "@/server/catalogue";
import { recordPaymentLedger } from "@/server/ledger";
import { resolvePaymentMethod } from "@/server/payment-methods";
import { chargeStoredMethod, initiatePayment, initiatePolicyCollection, type InitiatePaymentResult, type PaymentOutcome } from "@/server/payments";
import { siteUrl, simulatorEnabled } from "@/server/env";
import { planDb, type MicroSessionRow, type VersionPlanColumns } from "@/server/plan-db";

/**
 * Micro and on-demand cover (Addendum 6 item 1; roadmap Phase 3). Daily / weekly / monthly low-cost
 * policies bought in a few taps by mobile money — on the web, in the app, on WhatsApp or by USSD.
 *
 * One policy per customer × product; every window ("session") is paid separately as an ordinary
 * premium payment to the insurer in GHS. A session's status `active` means its window is paid; cover
 * is live only while the POLICY is active (only the insurer — or delegated L2 issuance — activates it).
 *
 * L2 (delegated, instant) micro products are sold insurer-direct with no broker: request + binding
 * quote + application + payment in one step, then delegated issuance. Other products follow the
 * normal routing (`createRequest`) and are quoted by the broker / insurer.
 *
 * Exported for other channels (USSD, WhatsApp): `listMicroProducts`, `buyMicroCover`, `renewMicro`,
 * `setMicroAutoRenew`, `listMicroPolicies`, `microQuoteFor`.
 */
type Svc = ReturnType<typeof createServiceClient>;
type AnyClient = SupabaseClient<Database>;
export type MicroChannel = "app" | "whatsapp" | "ussd" | "web";
export type MicroSession = MicroSessionRow;

type VersionRow = Row<"product_versions"> & VersionPlanColumns;
interface LoadedMicroVersion {
  version: VersionRow;
  product: { id: string; name: string; insurer_org_id: string; category_id: string; status: string; current_version_id: string | null };
  insurer: { id: string; name: string; integration_level: Enum<"integration_level"> | null; status: string };
  category: { id: string; slug: string; name: string };
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const toDate = (iso: string) => iso.slice(0, 10);
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
const SOURCE: Record<MicroChannel, Enum<"request_source">> = { app: "mobile", whatsapp: "whatsapp", ussd: "api", web: "web" };

/** Premium per period for a version (rate tables resolved), from the insurer's `period_factors` or pro rata. */
export async function microPricing(client: AnyClient, version: Pick<VersionRow, "rating" | "periods">, risk: RiskData = {}): Promise<Partial<Record<PolicyPeriod, number>>> {
  const rule = version.rating as unknown as RatingRule & { period_factors?: unknown; period_min_premium?: unknown };
  const periods = supportedPeriods(version.periods);
  if (!rule || !periods.length) return {};
  if (rule.model === "rate_table") {
    const annual = await quoteVersion(client as Svc, rule, risk);
    if (!annual.ok) return {};
    return ratePremium({ model: "flat", amount: annual.premium, period_factors: rule.period_factors, period_min_premium: rule.period_min_premium } as unknown as RatingRule, {}, { periods }).byPeriod ?? {};
  }
  const r = ratePremium(rule, risk, { periods });
  return r.ok ? r.byPeriod ?? {} : {};
}

async function loadMicroVersion(client: AnyClient, versionId: string): Promise<LoadedMicroVersion | null> {
  const db = planDb(client as Svc);
  const { data: version } = await db.from("product_versions").select("*").eq("id", versionId).maybeSingle();
  if (!version) return null;
  const { data: product } = await client.from("products").select("id, name, insurer_org_id, category_id, status, current_version_id").eq("id", version.product_id).maybeSingle();
  if (!product) return null;
  const [{ data: insurer }, { data: category }] = await Promise.all([
    client.from("organizations").select("id, name, integration_level, status").eq("id", product.insurer_org_id).maybeSingle(),
    client.from("product_categories").select("id, slug, name").eq("id", product.category_id).maybeSingle(),
  ]);
  if (!insurer || !category) return null;
  return { version: version as VersionRow, product, insurer, category };
}

/** Published micro products (current approved version of an approved product), optionally for one audience. */
export async function listMicroProducts(client: AnyClient, audience?: string | null): Promise<MicroProductCard[]> {
  const db = planDb(client as Svc);
  const { data: versions } = await db.from("product_versions").select("*").eq("micro", true).eq("status", "approved").limit(200);
  if (!versions?.length) return [];
  const { data: products } = await client.from("products").select("id, name, insurer_org_id, category_id, status, current_version_id").in("id", [...new Set(versions.map((v) => v.product_id))]).eq("status", "approved");
  const live = (products ?? []).filter((p) => versions.some((v) => v.id === p.current_version_id));
  if (!live.length) return [];
  const [{ data: insurers }, { data: categories }] = await Promise.all([
    client.from("organizations").select("id, name").in("id", [...new Set(live.map((p) => p.insurer_org_id))]),
    client.from("product_categories").select("id, slug").in("id", [...new Set(live.map((p) => p.category_id))]),
  ]);
  const rows = await Promise.all(
    live.map(async (p) => {
      const v = versions.find((x) => x.id === p.current_version_id)!;
      const coverage = Array.isArray(v.coverage) ? (v.coverage as { label?: string; title?: string }[]) : [];
      return {
        versionId: v.id,
        productName: p.name,
        insurerName: (insurers ?? []).find((i) => i.id === p.insurer_org_id)?.name ?? "Insurer",
        categorySlug: (categories ?? []).find((c) => c.id === p.category_id)?.slug ?? null,
        micro: true,
        audienceTags: v.audience_tags ?? [],
        periods: v.periods ?? [],
        byPeriod: await microPricing(client, v),
        summary: coverage.map((c) => c.label ?? c.title).filter(Boolean).slice(0, 3).join(" · ") || v.key_exclusion || null,
      };
    }),
  );
  return microProducts(rows, audience);
}

/** SMS / USSD quote line (≤ 160 chars) for a version and period. */
export async function microQuoteFor(versionId: string, period: MicroCoverPeriod, action?: string | null): Promise<{ amount: number; text: string } | null> {
  const svc = createServiceClient();
  const loaded = await loadMicroVersion(svc, versionId);
  if (!loaded) return null;
  const amount = (await microPricing(svc, loaded.version))[period];
  if (!amount) return null;
  return { amount, text: microQuoteText({ productName: loaded.product.name, insurerName: loaded.insurer.name, period, amount, action }) };
}

// ---------------------------------------------------------------------------
// Buy
// ---------------------------------------------------------------------------
export type BuyMicroResult =
  | { mode: "instant"; requestId: string; quoteId: string; applicationId: string; amount: number; period: MicroCoverPeriod; payment: InitiatePaymentResult; quoteText: string }
  | { mode: "routed"; requestId: string; amount: number | null; period: MicroCoverPeriod; nextStep: string };

/**
 * One-step micro purchase. L2 instant products: an insurer-direct request, a binding quote for the
 * window, the application (micro terms accepted) and the payment (`initiatePayment`, MoMo prompt or
 * card checkout). Everything else is routed with `createRequest` (a broker / the insurer quotes).
 */
export async function buyMicroCover(
  customerId: string,
  productVersionId: string,
  period: MicroCoverPeriod,
  channel: MicroChannel,
  opts: { payment?: "mobile_money" | "card"; momo?: { phone: string; network: "mtn" | "vod" | "atl" } | null; autoRenew?: boolean; risk?: Record<string, unknown>; callbackUrl?: string } = {},
): Promise<BuyMicroResult> {
  const svc = createServiceClient();
  if (!isMicroPeriod(period)) throw new BusinessRuleError("Choose a day, a week or a month.", "invalid_input");
  const loaded = await loadMicroVersion(svc, productVersionId);
  if (!loaded || !loaded.version.micro || loaded.version.status !== "approved" || loaded.product.status !== "approved" || loaded.product.current_version_id !== loaded.version.id) {
    throw new BusinessRuleError("This micro cover isn't available right now.", "not_found");
  }
  const { version, product, insurer, category } = loaded;
  if (insurer.status !== "active") throw new BusinessRuleError(`${insurer.name} isn't taking new cover right now.`);
  if (!supportedPeriods(version.periods).includes(period)) throw new BusinessRuleError(`${product.name} isn't sold by the ${PERIOD_LABEL[period].noun}.`, "invalid_input");
  const risk = { ...(opts.risk ?? {}), micro_period: period, product_version_id: version.id, preferred_insurer_org_id: insurer.id };
  const amount = (await microPricing(svc, version, opts.risk ?? {}))[period] ?? null;
  const payment = opts.payment ?? "mobile_money";
  if (payment === "mobile_money" && !opts.momo) throw new BusinessRuleError("Enter the mobile money number to charge.", "invalid_input");

  const { data: line } = await svc.from("insurer_line_integrations").select("level, active, issuance_type").eq("insurer_org_id", insurer.id).eq("category_id", category.id).maybeSingle();
  const instant = !!line?.active && String(line.level).toUpperCase() === "L2" && !!amount;
  if (!instant) {
    const { request } = await createRequest({ categorySlug: category.slug, risk, source: SOURCE[channel], submit: true }, { supabase: svc as unknown as NonNullable<NonNullable<Parameters<typeof createRequest>[1]>["supabase"]>, userId: customerId });
    return { mode: "routed", requestId: request.id, amount, period, nextStep: request.next_step ?? "We'll confirm your quote shortly." };
  }

  // Insurer-direct order (no broker for delegated L2 instant products).
  const title = `${product.name} · 1 ${PERIOD_LABEL[period].noun}`;
  const { data: request, error: reqErr } = await svc
    .from("requests")
    .insert({ customer_id: customerId, category_id: category.id, type: "new_cover", status: "quotes_ready", source: SOURCE[channel], title, risk_data: risk as Json, risk_fingerprint: `micro:${customerId}:${version.id}:${Date.now()}`, routing_mode: "insurer_direct", needs_adviser_review: false, next_step: "Pay to start your cover." })
    .select("id, reference")
    .single();
  if (reqErr || !request) throw new BusinessRuleError(ruleMessage(reqErr, "We couldn't start your cover."));
  await svc.from("order_routing").upsert({ request_id: request.id, mode: "insurer_direct", rule: "micro_instant", insurer_org_id: insurer.id, broker_org_id: null, reason: "Micro product with delegated (L2) issuance: sold directly by the insurer.", decided_at: new Date().toISOString(), decided_by: "engine" }, { onConflict: "request_id" });
  const { data: sub } = await svc
    .from("insurer_submissions")
    .insert({ request_id: request.id, insurer_org_id: insurer.id, broker_org_id: null, risk_fingerprint: `micro:${request.id}`, channel: insurer.integration_level ?? "portal", status: "quoted", sent_at: new Date().toISOString(), responded_at: new Date().toISOString(), response_due_at: new Date(Date.now() + 3_600_000).toISOString(), idempotency_key: `${request.id}:${insurer.id}:micro` })
    .select("id")
    .maybeSingle();
  const { data: quote, error: qErr } = await svc
    .from("quotes")
    .insert({
      request_id: request.id,
      submission_id: sub?.id ?? null,
      insurer_org_id: insurer.id,
      broker_org_id: null,
      product_id: product.id,
      product_version_id: version.id,
      status: "ready_to_accept",
      premium: amount!,
      taxes: 0,
      fees: 0,
      billing_period: period,
      limits: version.limits,
      excesses: version.excesses,
      coverage: version.coverage,
      exclusions: version.exclusions,
      key_exclusion: version.key_exclusion,
      waiting_period_days: version.waiting_period_days,
      optional_benefits: [] as unknown as Json,
      conditions: version.conditions,
      assumptions: { micro: true, period, rating: "period_pricing", issuance: { issuanceType: version.issuance_type } } as unknown as Json,
      valid_until: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      commission_disclosure: "Sold directly by the insurer. Covva is a technology platform and is paid a platform fee by the insurer.",
    })
    .select("id")
    .single();
  if (qErr || !quote) throw new BusinessRuleError(ruleMessage(qErr, "We couldn't price your cover."));
  const { data: app, error: appErr } = await svc
    .from("applications")
    .insert({ request_id: request.id, quote_id: quote.id, customer_id: customerId, status: "submitted", declarations: { micro_terms: true, channel, declared_at: new Date().toISOString() } as Json, selected_benefits: [] as unknown as Json, terms_accepted_at: new Date().toISOString(), terms_version: "micro-v1" })
    .select("id")
    .single();
  if (appErr || !app) throw new BusinessRuleError(ruleMessage(appErr, "We couldn't submit your application."));
  const pay = await initiatePayment({
    applicationId: app.id,
    channel: payment,
    momo: opts.momo ? { phone: opts.momo.phone, provider: opts.momo.network } : undefined,
    userId: customerId,
    callbackUrl: opts.callbackUrl ?? `${siteUrl()}/account/micro`,
    saveMethod: payment === "card" && !!opts.autoRenew,
    plan: { micro: { period, channel, autoRenew: !!opts.autoRenew } },
  });
  return { mode: "instant", requestId: request.id, quoteId: quote.id, applicationId: app.id, amount: amount!, period, payment: pay, quoteText: microQuoteText({ productName: product.name, insurerName: insurer.name, period, amount: amount!, action: "Approve the MoMo prompt to pay." }) };
}

/**
 * `applyPaymentResult` hook (before issuance): the checkout payment of a micro purchase created the
 * policy — record its period / auto-renew, set the cover dates to the window and log the paid session.
 */
export async function activateMicroSession(svc: Svc, payment: Row<"payments">, policyId: string): Promise<void> {
  const db = planDb(svc);
  const micro = asObject(asObject(asObject(payment.raw_event).initialize).micro);
  const period = isMicroPeriod(micro.period) ? micro.period : "day";
  const channel = (["app", "whatsapp", "ussd", "web"] as const).find((c) => c === micro.channel) ?? "app";
  const { data: existing } = await db.from("micro_sessions").select("id").eq("payment_id", payment.id).maybeSingle();
  if (existing) return;
  const w = coverWindow(period, payment.paid_at ?? new Date());
  await db.from("policies").update({ period, micro: true, auto_renew: micro.autoRenew === true, cover_start: toDate(w.startsAt), cover_end: toDate(w.endsAt) }).eq("id", policyId);
  const { error } = await db.from("micro_sessions").insert({ policy_id: policyId, customer_id: payment.customer_id, period, starts_at: w.startsAt, ends_at: w.endsAt, amount: Number(payment.amount), payment_id: payment.id, channel, status: "active" });
  if (error) log.error("micro.session_insert_failed", { paymentId: payment.id, err: error });
}

// ---------------------------------------------------------------------------
// Renew (one tap) and auto-renew
// ---------------------------------------------------------------------------
export interface RenewMicroResult {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  amount: number;
  paymentId: string | null;
  status: Enum<"payment_status"> | "link_sent";
  authorizationUrl: string | null;
  displayText: string | null;
}

async function ownMicroPolicy(svc: Svc, policyId: string, userId: string | null) {
  const { data: policy } = await planDb(svc).from("policies").select("*").eq("id", policyId).maybeSingle();
  if (!policy || !policy.micro || (userId && policy.customer_id !== userId)) throw new BusinessRuleError("Micro cover not found.", "not_found");
  return policy;
}

/** One-tap renewal: the next window starts when the current one ends (no gap). */
export async function renewMicro(
  policyId: string,
  userId: string | null,
  opts: { period?: MicroCoverPeriod; channel?: "mobile_money" | "card" | "link"; momo?: { phone: string; network: "mtn" | "vod" | "atl" } | null; paymentMethodId?: string | null; sessionChannel?: MicroChannel; automatic?: boolean } = {},
): Promise<RenewMicroResult> {
  const svc = createServiceClient();
  const db = planDb(svc);
  const policy = await ownMicroPolicy(svc, policyId, userId);
  if (!["active", "expired"].includes(policy.status)) throw new BusinessRuleError(`This cover is ${policy.status.replace(/_/g, " ")}; it can't be renewed here.`);
  if (!policy.product_version_id) throw new BusinessRuleError("This cover has no product to renew.");
  const loaded = await loadMicroVersion(svc, policy.product_version_id);
  if (!loaded) throw new BusinessRuleError("This micro cover is no longer sold.", "not_found");
  // Renew on the product's current approved version (the insurer's latest price).
  const current = loaded.product.current_version_id && loaded.product.current_version_id !== loaded.version.id ? await loadMicroVersion(svc, loaded.product.current_version_id) : loaded;
  const version = current?.version.status === "approved" && current.version.micro ? current.version : loaded.version;
  const period = opts.period ?? (isMicroPeriod(policy.period) ? policy.period : "day");
  if (!supportedPeriods(version.periods).includes(period)) throw new BusinessRuleError(`This cover isn't sold by the ${PERIOD_LABEL[period].noun}.`, "invalid_input");
  const risk = (asObject(policy.insured_items).risk ?? {}) as RiskData;
  const amount = (await microPricing(svc, version, risk))[period];
  if (!amount) throw new BusinessRuleError("We couldn't price the renewal. Try again later.");

  const { data: last } = await db.from("micro_sessions").select("*").eq("policy_id", policy.id).in("status", ["active", "pending"]).order("ends_at", { ascending: false }).limit(1).maybeSingle();
  let session: MicroSessionRow;
  if (last && last.status === "pending" && Date.parse(last.starts_at) >= Date.now() - 86_400_000 && last.period === period) {
    session = last; // a renewal already waiting for payment (e.g. an auto-renew pay link)
  } else {
    const startBase = (await db.from("micro_sessions").select("ends_at").eq("policy_id", policy.id).eq("status", "active").order("ends_at", { ascending: false }).limit(1).maybeSingle()).data?.ends_at ?? null;
    const w = coverWindow(period, renewalStart(startBase));
    const { data: created, error } = await db.from("micro_sessions").insert({ policy_id: policy.id, customer_id: policy.customer_id, period, starts_at: w.startsAt, ends_at: w.endsAt, amount, channel: opts.sessionChannel ?? "app", status: "pending" }).select("*").single();
    if (error || !created) throw new BusinessRuleError(ruleMessage(error, "We couldn't start the renewal."));
    session = created;
  }
  const tags = { micro_session_id: session.id, micro_policy_id: policy.id };
  const key = `micro:${session.id}:${opts.automatic ? "auto" : "tap"}:${Date.now().toString(36).slice(-4)}`;
  const description = `${loaded.product.name} · 1 ${PERIOD_LABEL[period].noun} from ${fmtWhen(session.starts_at)}`;

  if (opts.channel === "card" || (!opts.channel && !opts.momo)) {
    const method = await resolvePaymentMethod(svc, policy.customer_id, opts.paymentMethodId);
    if (method || (opts.channel === "card" && simulatorEnabled())) {
      const { data: full } = await svc.from("policies").select("id, request_id, quote_id, customer_id, insurer_org_id, broker_org_id").eq("id", policy.id).single();
      const r = await chargeStoredMethod({ subscription: { id: session.id, ghs_amount: amount, display_currency: "GHS", sponsor_user_id: policy.customer_id }, collection: { tags, idempotencyKey: key }, method, policy: { ...full!, insurer_org_id: full!.insurer_org_id! }, attempt: 1, chargeNo: 1 });
      await db.from("micro_sessions").update({ payment_id: r.paymentId }).eq("id", session.id).eq("status", "pending");
      return { sessionId: session.id, startsAt: session.starts_at, endsAt: session.ends_at, amount, paymentId: r.paymentId, status: r.status, authorizationUrl: null, displayText: null };
    }
    if (opts.channel === "card") throw new BusinessRuleError("Save a card first: pay once by card and tick “keep my card”.");
  }
  if (opts.automatic && !opts.momo) {
    await notify({ userId: policy.customer_id, kind: "micro.renew_link", title: `Renew ${loaded.product.name}: ${formatMoney(amount, "GHS")}`, body: `Your cover ends ${fmtWhen(session.starts_at)}. Renew for 1 ${PERIOD_LABEL[period].noun} by mobile money: ${siteUrl()}/account/micro?renew=${policy.id}`, link: `/account/micro?renew=${policy.id}`, data: { policy_id: policy.id, session_id: session.id }, channels: ["in_app", "push", "whatsapp", "sms"] });
    return { sessionId: session.id, startsAt: session.starts_at, endsAt: session.ends_at, amount, paymentId: null, status: "link_sent", authorizationUrl: null, displayText: "We sent a payment link." };
  }
  const r = await initiatePolicyCollection({ policyId: policy.id, payerUserId: policy.customer_id, amount, tags, idempotencyKey: key, channel: opts.momo ? "mobile_money" : "link", momo: opts.momo ? { phone: opts.momo.phone, provider: opts.momo.network } : null, callbackUrl: `${siteUrl()}/account/micro`, description });
  await db.from("micro_sessions").update({ payment_id: r.paymentId }).eq("id", session.id).eq("status", "pending");
  return { sessionId: session.id, startsAt: session.starts_at, endsAt: session.ends_at, amount, paymentId: r.paymentId, status: r.status, authorizationUrl: r.authorizationUrl, displayText: r.displayText };
}

/** Apply a PSP outcome to a micro renewal payment (`raw_event.micro_session_id`). Idempotent. */
export async function applyMicroRenewalOutcome(svc: Svc, payment: Row<"payments">, outcome: PaymentOutcome): Promise<{ status: Enum<"payment_status"> | null; policyId?: string | null }> {
  const db = planDb(svc);
  const raw = asObject(payment.raw_event);
  const event = (outcome.event ?? null) as Json;
  const { data: session } = typeof raw.micro_session_id === "string" ? await db.from("micro_sessions").select("*").eq("id", raw.micro_session_id).maybeSingle() : { data: null };
  if (!session) {
    log.error("micro.payment_orphan", { paymentId: payment.id });
    return { status: payment.status };
  }
  if (outcome.status !== "succeeded") {
    if (payment.status !== "pending" && payment.status !== "processing") return { status: payment.status };
    const status = outcome.status === "abandoned" ? "abandoned" : "failed";
    const reason = outcome.failureReason ?? "Payment not completed";
    const { data: updated } = await svc.from("payments").update({ status, failure_reason: reason.slice(0, 500), raw_event: { ...raw, last_event: event } as Json }).eq("id", payment.id).in("status", ["pending", "processing"]).select("id");
    if (updated?.length) {
      await db.from("micro_sessions").update({ status: "failed" }).eq("id", session.id).eq("status", "pending");
      await notify({ userId: session.customer_id, kind: "payment.failed", title: "Renewal not paid", body: `${reason}. Your cover ends ${fmtWhen(session.starts_at)}. Tap Renew to try again.`, link: "/account/micro", data: { policy_id: session.policy_id, session_id: session.id } });
    }
    return { status };
  }
  const expectedMinor = Math.round(Number(payment.amount) * 100);
  if ((outcome.amountMinor !== undefined && outcome.amountMinor < expectedMinor) || (outcome.currency && outcome.currency !== payment.currency)) {
    log.error("micro.amount_mismatch", { paymentId: payment.id, expectedMinor, got: outcome.amountMinor });
    await svc.from("payments").update({ status: "failed", failure_reason: "Amount or currency did not match — referred to operations" }).eq("id", payment.id).in("status", ["pending", "processing"]);
    return { status: "failed" };
  }
  const paidAt = outcome.paidAt ?? new Date().toISOString();
  const { data: claimed } = await svc.from("payments").update({ status: "succeeded", paid_at: paidAt, failure_reason: null, raw_event: { ...raw, last_event: event, confirmed_by: outcome.source } as Json }).eq("id", payment.id).neq("status", "succeeded").select("id");
  if (!claimed?.length) return { status: "succeeded", policyId: payment.policy_id };
  await recordPaymentLedger(svc, { ...payment, status: "succeeded", paid_at: paidAt });

  // A late payment never back-dates cover: the window starts no earlier than now.
  let { starts_at: startsAt, ends_at: endsAt } = session;
  if (Date.parse(startsAt) < Date.parse(paidAt)) {
    const w = coverWindow(session.period as PolicyPeriod, new Date(paidAt));
    startsAt = w.startsAt;
    endsAt = w.endsAt;
  }
  await db.from("micro_sessions").update({ status: "active", payment_id: payment.id, starts_at: startsAt, ends_at: endsAt }).eq("id", session.id);
  const { data: policy } = await db.from("policies").select("id, status, cover_end, cover_start, insurer_org_id, internal_reference").eq("id", session.policy_id).maybeSingle();
  if (policy) {
    const coverEnd = !policy.cover_end || policy.cover_end < toDate(endsAt) ? toDate(endsAt) : policy.cover_end;
    const patch: { cover_end: string; status?: "active"; cover_start?: string } = { cover_end: coverEnd };
    // An expired micro policy resumes with the new paid window (it keeps the insurer's number).
    if (policy.status === "expired") {
      patch.status = "active";
      patch.cover_start = toDate(startsAt);
    }
    const { error } = await db.from("policies").update(patch).eq("id", policy.id).in("status", ["active", "expired"]);
    if (error) log.error("micro.policy_extend_failed", { policyId: policy.id, err: error });
    if (policy.status !== "active" && policy.status !== "expired" && policy.insurer_org_id) {
      await notifyOrg(policy.insurer_org_id, { kind: "micro.renewal_attention", title: `Micro renewal paid on a ${policy.status} policy · ${policy.internal_reference}`, body: "Issue, reinstate or refund under your rules.", link: `/partner/policies/${policy.id}`, data: { policy_id: policy.id, payment_id: payment.id } });
    }
  }
  if (payment.request_id) await svc.from("request_events").insert({ request_id: payment.request_id, actor_party: "system", event: "payment_confirmed", note: `Micro cover renewed: ${formatMoney(Number(payment.amount), "GHS")} paid to the insurer for ${fmtWhen(startsAt)} – ${fmtWhen(endsAt)}.`, data: { payment_id: payment.id, session_id: session.id } as Json });
  await notify({ userId: session.customer_id, kind: "payment.succeeded", title: "Cover renewed", body: `${formatMoney(Number(payment.amount), "GHS")} paid to the insurer. Covered until ${fmtWhen(endsAt)}.`, link: "/account/micro", data: { policy_id: session.policy_id, session_id: session.id, payment_id: payment.id } });
  return { status: "succeeded", policyId: session.policy_id };
}

export async function setMicroAutoRenew(policyId: string, userId: string, on: boolean): Promise<{ policyId: string; autoRenew: boolean }> {
  const svc = createServiceClient();
  await ownMicroPolicy(svc, policyId, userId);
  const { error } = await planDb(svc).from("policies").update({ auto_renew: on }).eq("id", policyId);
  if (error) throw new BusinessRuleError(ruleMessage(error, "We couldn't update auto-renew."));
  return { policyId, autoRenew: on };
}

export interface MicroPolicyView {
  id: string;
  internal_reference: string;
  policy_number: string | null;
  status: string;
  summary: string | null;
  period: string;
  auto_renew: boolean;
  cover_end: string | null;
  product_version_id: string | null;
  /** The paid window covering now (null when none). */
  current: MicroSessionRow | null;
  /** The latest paid window (for "renew from …"). */
  latest: MicroSessionRow | null;
  sessions: MicroSessionRow[];
  /** Cover is live: policy active and a paid window covers now. */
  covered: boolean;
}

export async function listMicroPolicies(userId: string): Promise<MicroPolicyView[]> {
  const svc = createServiceClient();
  const db = planDb(svc);
  const { data: policies } = await db.from("policies").select("id, internal_reference, policy_number, status, summary, period, auto_renew, cover_end, product_version_id").eq("customer_id", userId).eq("micro", true).order("created_at", { ascending: false }).limit(50);
  if (!policies?.length) return [];
  const { data: sessions } = await db.from("micro_sessions").select("*").in("policy_id", policies.map((p) => p.id)).order("ends_at", { ascending: false }).limit(500);
  const now = Date.now();
  return policies.map((p) => {
    const mine = (sessions ?? []).filter((s) => s.policy_id === p.id);
    const paid = mine.filter((s) => s.status === "active" || s.status === "expired");
    const current = paid.find((s) => Date.parse(s.starts_at) <= now && Date.parse(s.ends_at) > now) ?? null;
    return { ...p, current, latest: paid[0] ?? null, sessions: mine.slice(0, 10), covered: p.status === "active" && !!current };
  });
}

// ---------------------------------------------------------------------------
// Cron `micro-renewals` (hourly at :40)
// ---------------------------------------------------------------------------
export async function microRenewals(svc: Svc): Promise<Record<string, unknown>> {
  const db = planDb(svc);
  const nowIso = new Date().toISOString();
  // Windows that ended are marked expired (the policy-lifecycle cron expires the policy by cover_end).
  const { data: ended } = await db.from("micro_sessions").update({ status: "expired" }).eq("status", "active").lt("ends_at", nowIso).select("id");
  const { data: policies } = await db.from("policies").select("id, customer_id, period").eq("micro", true).eq("auto_renew", true).eq("status", "active").limit(1000);
  let charged = 0;
  let linked = 0;
  let skipped = 0;
  for (const p of policies ?? []) {
    const { data: latest } = await db.from("micro_sessions").select("*").eq("policy_id", p.id).in("status", ["active", "pending"]).order("ends_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest || latest.status === "pending" || !isMicroPeriod(p.period) || !autoRenewDue(p.period, latest.ends_at)) {
      skipped++;
      continue;
    }
    try {
      const r = await renewMicro(p.id, null, { period: p.period, automatic: true, sessionChannel: "app" });
      if (r.status === "link_sent") linked++;
      else charged++;
    } catch (err) {
      skipped++;
      log.warn("micro.auto_renew_failed", { policyId: p.id, err });
    }
  }
  return { expired_windows: ended?.length ?? 0, auto_renew_policies: policies?.length ?? 0, charged, links_sent: linked, skipped };
}

/** Buy page: one micro version with its price per supported micro period (null when not on sale). */
export async function microProductForBuy(versionId: string): Promise<{ versionId: string; productName: string; insurerName: string; prices: { period: MicroCoverPeriod; amount: number }[]; keyExclusion: string | null } | null> {
  const svc = createServiceClient();
  const loaded = await loadMicroVersion(svc, versionId);
  if (!loaded || !loaded.version.micro || loaded.version.status !== "approved" || loaded.product.status !== "approved" || loaded.product.current_version_id !== loaded.version.id) return null;
  const byPeriod = await microPricing(svc, loaded.version);
  const prices = (["day", "week", "month"] as const).filter((p) => supportedPeriods(loaded.version.periods).includes(p) && (byPeriod[p] ?? 0) > 0).map((p) => ({ period: p, amount: byPeriod[p]! }));
  return { versionId, productName: loaded.product.name, insurerName: loaded.insurer.name, prices, keyExclusion: loaded.version.key_exclusion };
}
