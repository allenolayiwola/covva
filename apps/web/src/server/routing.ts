import "server-only";
import {
  decideRouting,
  offerDeadline,
  offerRoundState,
  planOfferRound,
  type ConsideredBroker,
  type EngineCandidate,
  type IntegrationLevel,
  type LineIntegration,
  type RoutingEngineDecision,
  type RoutingMode,
} from "@im/core";
import type { Enum, Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";
import { notify, notifyOrg } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";
import { siteUrl } from "@/lib/site-url";

/**
 * Routing engine integration (Addendum 2 D/E). Loads the facts the pure engine needs
 * (customer's standing broker, the insurer's line integration, eligible brokers with
 * verified appointments), records the decision in `order_routing`, offers pool requests
 * to the top brokers with a one-tap accept link, and re-routes on expiry (cron).
 *
 * Everything here runs with the service client: routing is a system action across
 * organisations that RLS deliberately blocks for user sessions.
 */
type Svc = ReturnType<typeof createServiceClient>;

const OPEN_STATUSES: Enum<"request_status">[] = ["submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready"];

export const acceptLink = (token: string) => `${siteUrl()}/partner/offers/accept/${encodeURIComponent(token)}`;
export const acceptDeepLink = (token: string) => `covva://offers/accept/${encodeURIComponent(token)}`;

async function setting<T>(svc: Svc, key: string, fallback: T): Promise<T> {
  const { data } = await svc.from("platform_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

async function settingNumber(svc: Svc, key: string, fallback: number): Promise<number> {
  const v = Number(await setting<unknown>(svc, key, fallback));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export interface RoutingSettings {
  offerTimeoutMinutes: number;
  offerBatchSize: number;
  maxRounds: number;
  sumInsuredThreshold: number | null;
}

export async function routingSettings(svc: Svc): Promise<RoutingSettings> {
  const [offerTimeoutMinutes, offerBatchSize, maxRounds, sumInsured] = await Promise.all([
    settingNumber(svc, "routing.offer_timeout_minutes", 30),
    settingNumber(svc, "routing.offer_batch_size", 3),
    settingNumber(svc, "routing.max_rounds", 3),
    setting<unknown>(svc, "routing.sum_insured_threshold", 2_000_000),
  ]);
  const threshold = Number(sumInsured);
  return { offerTimeoutMinutes, offerBatchSize, maxRounds, sumInsuredThreshold: sumInsured === null ? null : Number.isFinite(threshold) && threshold > 0 ? threshold : 2_000_000 };
}

type Category = Pick<Row<"product_categories">, "id" | "slug" | "name" | "segment">;
type RequestLite = Pick<Row<"requests">, "id" | "reference" | "customer_id" | "category_id" | "risk_data" | "title"> & { talk_to_expert?: boolean | null };

// ---------------------------------------------------------------------------
// Facts for the engine
// ---------------------------------------------------------------------------
/** Eligible brokers for a category: active routing rules + licence + verified appointments (insurer × line). */
export async function loadBrokerCandidates(svc: Svc, categoryId: string): Promise<EngineCandidate[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  const { data: rules } = await svc
    .from("broker_routing_rules")
    .select("broker_org_id, priority, is_secondary, regions, segments, daily_capacity, broker:organizations!broker_routing_rules_broker_org_id_fkey(id, name, status, nic_licence_number, nic_licence_expires_on, licence_verified_at)")
    .eq("category_id", categoryId)
    .eq("active", true);
  if (!rules?.length) return [];
  const brokerIds = [...new Set(rules.map((r) => r.broker_org_id))];

  const [{ data: appts }, { data: todays }, { data: recent }] = await Promise.all([
    svc.from("insurer_broker_appointments").select("broker_org_id, insurer_org_id, category_id, ends_on, insurer:organizations!insurer_broker_appointments_insurer_org_id_fkey(status)").eq("active", true).in("broker_org_id", brokerIds).or(`category_id.eq.${categoryId},category_id.is.null`),
    svc.from("requests").select("broker_org_id").in("broker_org_id", brokerIds).gte("created_at", today.toISOString()),
    svc.from("requests").select("broker_org_id, sla_breached_at").in("broker_org_id", brokerIds).gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(5000),
  ]);

  const out: EngineCandidate[] = [];
  for (const r of rules) {
    const broker = r.broker as unknown as Pick<Row<"organizations">, "id" | "name" | "status" | "nic_licence_number" | "nic_licence_expires_on" | "licence_verified_at"> | null;
    if (!broker) continue;
    const appointed = [
      ...new Set(
        (appts ?? [])
          .filter((a) => a.broker_org_id === broker.id && (!a.ends_on || a.ends_on >= todayIso) && (a.insurer as unknown as { status: string } | null)?.status === "active")
          .map((a) => a.insurer_org_id),
      ),
    ];
    const mine = (recent ?? []).filter((x) => x.broker_org_id === broker.id);
    out.push({
      brokerOrgId: broker.id,
      brokerName: broker.name,
      priority: r.priority,
      isSecondary: r.is_secondary,
      regions: r.regions,
      segments: r.segments,
      dailyCapacity: r.daily_capacity,
      openToday: (todays ?? []).filter((x) => x.broker_org_id === broker.id).length,
      insurerAccess: appointed.length,
      appointedInsurerOrgIds: appointed,
      licenceValid:
        broker.status === "active" &&
        !!broker.nic_licence_number &&
        (!broker.nic_licence_expires_on || new Date(broker.nic_licence_expires_on) >= today),
      slaBreachRate30d: mine.length ? mine.filter((x) => x.sla_breached_at).length / mine.length : 0,
    });
  }
  return out;
}

export async function loadLineIntegrations(svc: Svc, categoryId: string): Promise<LineIntegration[]> {
  const { data } = await svc
    .from("insurer_line_integrations")
    .select("insurer_org_id, level, direct_sales, nominated_broker_org_ids, active, insurer:organizations!insurer_line_integrations_insurer_org_id_fkey(name, status)")
    .eq("category_id", categoryId);
  return (data ?? []).map((i) => ({
    insurerOrgId: i.insurer_org_id,
    insurerName: (i.insurer as unknown as { name: string } | null)?.name,
    level: i.level as IntegrationLevel,
    directSales: i.direct_sales,
    nominatedBrokerOrgIds: i.nominated_broker_org_ids ?? [],
    active: i.active && (i.insurer as unknown as { status: string } | null)?.status === "active",
  }));
}

/** The insurer the customer chose, if the risk form carried one. */
export function preferredInsurerFromRisk(risk: Record<string, unknown>): string | null {
  for (const key of ["preferred_insurer_org_id", "insurer_org_id", "preferred_insurer"]) {
    const v = risk[key];
    if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) return v;
  }
  return null;
}

/** Runs the engine against live data without writing anything (used by the request flow and simulators). */
export async function decideForRequest(svc: Svc, req: RequestLite, category: Category, opts: { excludeInsurerIds?: string[]; fixedBrokerOrgId?: string | null } = {}): Promise<RoutingEngineDecision> {
  const risk = (req.risk_data ?? {}) as Record<string, unknown>;
  const excluded = new Set(opts.excludeInsurerIds ?? []);
  const [settings, assignment, allIntegrations, brokers, fixed] = await Promise.all([
    routingSettings(svc),
    svc.from("customer_broker_assignments").select("broker_org_id, source, broker:organizations!customer_broker_assignments_broker_org_id_fkey(name, status)").eq("customer_id", req.customer_id).eq("active", true).maybeSingle(),
    loadLineIntegrations(svc, category.id),
    loadBrokerCandidates(svc, category.id),
    opts.fixedBrokerOrgId ? svc.from("organizations").select("id, name, status").eq("id", opts.fixedBrokerOrgId).eq("type", "broker").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // A broker of record carried over (a renewal keeps the policy's broker) wins over the standing assignment.
  const carried = fixed.data && fixed.data.status === "active" ? { brokerOrgId: fixed.data.id, brokerName: fixed.data.name, source: "renewal" } : null;
  const standing = carried ?? (assignment.data && (assignment.data.broker as unknown as { status: string } | null)?.status === "active"
    ? { brokerOrgId: assignment.data.broker_org_id, brokerName: (assignment.data.broker as unknown as { name: string }).name, source: assignment.data.source }
    : null);
  // Re-route after an SLA breach: the breached insurer is left out (and no longer preferred).
  const integrations = excluded.size ? allIntegrations.filter((i) => !excluded.has(i.insurerOrgId)) : allIntegrations;
  const preferred = preferredInsurerFromRisk(risk);
  return decideRouting({
    request: {
      categorySlug: category.slug,
      segment: category.segment,
      region: typeof risk.region === "string" ? risk.region : undefined,
      talkToExpert: !!req.talk_to_expert || risk.talk_to_expert === true,
      risk,
      preferredInsurerOrgId: preferred && excluded.has(preferred) ? null : preferred,
    },
    customerAssignment: standing,
    integrations,
    brokers,
    thresholds: { sumInsured: settings.sumInsuredThreshold },
    offerTimeoutMinutes: settings.offerTimeoutMinutes,
    offerBatchSize: settings.offerBatchSize,
    maxRounds: settings.maxRounds,
  });
}

// ---------------------------------------------------------------------------
// Route a new request
// ---------------------------------------------------------------------------
export interface RoutingResult {
  mode: RoutingMode;
  rule: RoutingEngineDecision["rule"];
  reason: string;
  /** Broker of record now (broker_fixed only); pool requests get one when an offer is accepted. */
  brokerOrgId: string | null;
  insurerOrgId: string | null;
  offered: string[];
  candidates: ConsideredBroker[];
  complexityFlags: string[];
}

/**
 * Decides the routing for a freshly inserted request, records it (`order_routing`,
 * `requests.routing_mode`, timeline event), and either assigns the fixed broker, offers the
 * request to the first batch of eligible brokers, hands it to the insurer, or holds it for ops.
 */
export async function routeNewRequest(svc: Svc, req: RequestLite, opts: { category?: Category; excludeInsurerIds?: string[]; fixedBrokerOrgId?: string | null } = {}): Promise<RoutingResult> {
  const category = opts.category ?? (await svc.from("product_categories").select("id, slug, name, segment").eq("id", req.category_id).single()).data;
  if (!category) throw new Error("Unknown category for routing");
  const decision = await decideForRequest(svc, req, category, { excludeInsurerIds: opts.excludeInsurerIds, fixedBrokerOrgId: opts.fixedBrokerOrgId });
  const now = new Date();
  const offered: string[] = [];

  const { data: routing, error } = await svc
    .from("order_routing")
    .upsert(
      {
        request_id: req.id,
        mode: decision.mode,
        rule: decision.rule,
        insurer_org_id: decision.insurerOrgId ?? null,
        broker_org_id: decision.brokerOrgId ?? null,
        reason: decision.reason,
        candidates: decision.candidates as unknown as Json,
        complexity_flags: decision.complexityFlags,
        offer_timeout_minutes: decision.offerTimeoutMinutes,
        offer_batch_size: decision.offerBatchSize,
        max_rounds: decision.maxRounds,
        current_round: 0,
        expires_at: null,
        decided_at: now.toISOString(),
        decided_by: "engine",
        version: 1,
      },
      { onConflict: "request_id" },
    )
    .select("id")
    .single();
  if (error) throw error;

  await svc.from("request_events").insert({
    request_id: req.id,
    actor_party: "system",
    event: "routing_decision",
    note: decision.reason,
    visible_to_customer: false,
    data: { mode: decision.mode, rule: decision.rule, insurer_org_id: decision.insurerOrgId ?? null, broker_org_id: decision.brokerOrgId ?? null, complexity_flags: decision.complexityFlags, candidates: decision.candidates } as unknown as Json,
  });

  const patch: Partial<Row<"requests">> = { routing_mode: decision.mode, complexity_flags: decision.complexityFlags };
  if (decision.mode === "broker_fixed" && decision.brokerOrgId) patch.broker_org_id = decision.brokerOrgId;
  const { error: reqErr } = await svc.from("requests").update(patch).eq("id", req.id);
  if (reqErr) throw reqErr;

  if (decision.mode === "broker_pool") {
    offered.push(...(await offerRound(svc, req, { ...decision, routingId: routing.id }, 1, category)));
  } else if (decision.mode === "insurer_direct" && decision.insurerOrgId) {
    await createDirectSubmission(svc, req, decision.insurerOrgId);
    await notifyOrg(decision.insurerOrgId, {
      kind: "request.new",
      title: `New direct ${category.name.toLowerCase()} order ${req.reference}`,
      body: req.title ?? "A customer has ordered one of your products directly on Covva.",
      link: `/partner/submissions`,
      data: { request_id: req.id, mode: "insurer_direct" },
      channels: ["in_app", "email", "push"],
    });
  } else if (decision.mode === "ops_hold") {
    await notifyOps(svc, req, `No eligible broker for ${req.reference}`, decision.reason);
  }

  return {
    mode: decision.mode,
    rule: decision.rule,
    reason: decision.reason,
    brokerOrgId: decision.mode === "broker_fixed" ? decision.brokerOrgId ?? null : null,
    insurerOrgId: decision.insurerOrgId ?? null,
    offered,
    candidates: decision.candidates,
    complexityFlags: decision.complexityFlags,
  };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------
interface RoundCtx {
  routingId: string;
  candidates: ConsideredBroker[];
  offerTimeoutMinutes: number;
  offerBatchSize: number;
  maxRounds: number;
}

/** Creates the offers for `round` and notifies each broker. Returns the broker ids offered; empty when exhausted (→ ops hold). */
async function offerRound(svc: Svc, req: RequestLite, ctx: RoundCtx, round: number, category?: Category | null): Promise<string[]> {
  const { data: previous } = await svc.from("order_offers").select("broker_org_id").eq("request_id", req.id);
  const plan = planOfferRound(ctx.candidates, round, { batchSize: ctx.offerBatchSize, maxRounds: ctx.maxRounds, alreadyOffered: (previous ?? []).map((o) => o.broker_org_id) });
  const now = new Date();
  if (plan.exhausted) {
    await holdForOps(svc, req, ctx.routingId, round, `No broker accepted ${req.reference} after ${Math.max(round - 1, 0)} round${round - 1 === 1 ? "" : "s"} of offers.`);
    return [];
  }
  const deadline = offerDeadline(now, ctx.offerTimeoutMinutes);
  const { data: offers, error } = await svc
    .from("order_offers")
    .insert(plan.brokerOrgIds.map((brokerOrgId) => ({ request_id: req.id, broker_org_id: brokerOrgId, status: "offered", round, offered_at: now.toISOString(), responds_by: deadline.toISOString() })))
    .select("id, broker_org_id, accept_token, responds_by");
  if (error) throw error;

  await svc.from("order_routing").update({ current_round: round, expires_at: deadline.toISOString() }).eq("id", ctx.routingId);
  await svc.from("request_events").insert({
    request_id: req.id,
    actor_party: "system",
    event: "offers_sent",
    note: `Round ${round}: offered to ${plan.brokerOrgIds.length} broker${plan.brokerOrgIds.length === 1 ? "" : "s"} (${ctx.offerTimeoutMinutes} min to accept).`,
    visible_to_customer: false,
    data: { round, broker_org_ids: plan.brokerOrgIds, responds_by: deadline.toISOString() } as unknown as Json,
  });

  const catName = category?.name ?? (await svc.from("product_categories").select("name").eq("id", req.category_id).maybeSingle()).data?.name ?? "insurance";
  for (const o of offers ?? []) {
    const names = ctx.candidates.find((c) => c.brokerOrgId === o.broker_org_id)?.brokerName;
    await notifyOrg(
      o.broker_org_id,
      {
        kind: "offer.new",
        title: `New ${catName.toLowerCase()} request ${req.reference} — accept within ${ctx.offerTimeoutMinutes} min`,
        body: `${req.title ?? "A customer needs cover"}. First broker to accept becomes broker of record. Tap to accept: ${acceptLink(o.accept_token)}`,
        link: `/partner/offers/accept/${o.accept_token}`,
        data: {
          offer_id: o.id,
          request_id: req.id,
          round,
          responds_by: o.responds_by,
          accept_url: acceptLink(o.accept_token),
          deep_link: acceptDeepLink(o.accept_token),
          broker_name: names,
        },
        channels: ["in_app", "push", "email", "sms"],
      },
      ["owner", "admin", "supervisor", "adviser"],
    );
  }
  return plan.brokerOrgIds;
}

/**
 * Insurer-direct order (Addendum 2 D): a submission with no broker of record so the insurer's
 * queue shows it (the submissions guard allows a null broker only for insurer_direct routing),
 * plus the insurer's response SLA timer. Duplicate (same risk, same insurer) is a no-op.
 */
async function createDirectSubmission(svc: Svc, req: RequestLite, insurerOrgId: string) {
  try {
    const [{ data: line }, { data: full }] = await Promise.all([
      svc.from("insurer_line_integrations").select("sla_hours").eq("insurer_org_id", insurerOrgId).eq("category_id", req.category_id).maybeSingle(),
      svc.from("requests").select("risk_fingerprint").eq("id", req.id).maybeSingle(),
    ]);
    const now = Date.now();
    const dueAt = new Date(now + (line?.sla_hours ?? 24) * 3_600_000);
    const { data: sub, error } = await svc
      .from("insurer_submissions")
      .insert({ request_id: req.id, insurer_org_id: insurerOrgId, broker_org_id: null, risk_fingerprint: full?.risk_fingerprint ?? `direct:${req.id}`, channel: "portal", status: "sent", sent_at: new Date(now).toISOString(), response_due_at: dueAt.toISOString(), idempotency_key: `${req.id}:${insurerOrgId}:direct` })
      .select("id")
      .single();
    if (error && error.code !== "23505") throw error;
    if (sub) {
      const { startTimer } = await import("@/server/sla");
      await startTimer(svc, { type: "submission", id: sub.id }, dueAt, { insurerOrgId });
    }
  } catch (err) {
    log.error("routing.direct_submission_failed", { requestId: req.id, insurerOrgId, err });
  }
}

async function holdForOps(svc: Svc, req: RequestLite, routingId: string, round: number, reason: string) {
  const { data: current } = await svc.from("order_routing").select("version").eq("id", routingId).maybeSingle();
  await svc
    .from("order_routing")
    .update({ mode: "ops_hold", rule: "ops_hold", reason, expires_at: null, current_round: round, decided_at: new Date().toISOString(), decided_by: "engine", version: (current?.version ?? 1) + 1 })
    .eq("id", routingId);
  await svc.from("requests").update({ routing_mode: "ops_hold", next_step: "Our team is finding the right broker for your request." }).eq("id", req.id);
  await svc.from("request_events").insert({ request_id: req.id, actor_party: "system", event: "routing_ops_hold", note: reason, visible_to_customer: false, data: { round } as Json });
  await notifyOps(svc, req, `Request ${req.reference} needs a broker`, reason);
}

async function notifyOps(svc: Svc, req: RequestLite, title: string, body: string) {
  const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
  if (!platform) {
    log.warn("routing.no_platform_org", { requestId: req.id });
    return;
  }
  await notifyOrg(platform.id, { kind: "routing.ops_hold", title, body, link: `/requests/${req.id}`, data: { request_id: req.id }, channels: ["in_app", "email"] }, ["platform_admin", "platform_ops"]);
}

/**
 * Re-routes a pool request whose current round is closed (every offer expired, declined or
 * withdrawn) and that still has no broker: next round of offers, or ops hold when exhausted.
 */
export async function rerouteIfRoundClosed(svc: Svc, requestId: string): Promise<{ action: "none" | "offered" | "held" | "withdrawn"; round?: number }> {
  const [{ data: routing }, { data: req }, { data: offers }] = await Promise.all([
    svc.from("order_routing").select("id, mode, candidates, offer_timeout_minutes, offer_batch_size, max_rounds, current_round").eq("request_id", requestId).maybeSingle(),
    svc.from("requests").select("id, reference, customer_id, category_id, risk_data, title, status, broker_org_id, talk_to_expert").eq("id", requestId).maybeSingle(),
    svc.from("order_offers").select("id, broker_org_id, status, round, responds_by").eq("request_id", requestId),
  ]);
  if (!routing || !req) return { action: "none" };

  // Closed or claimed requests: withdraw anything still open.
  if (!OPEN_STATUSES.includes(req.status) || req.broker_org_id) {
    const open = (offers ?? []).filter((o) => o.status === "offered").map((o) => o.id);
    if (open.length) {
      await svc.from("order_offers").update({ status: "withdrawn", responded_at: new Date().toISOString() }).in("id", open);
      await svc.from("order_routing").update({ expires_at: null }).eq("id", routing.id);
      return { action: "withdrawn" };
    }
    return { action: "none" };
  }
  if (routing.mode !== "broker_pool") return { action: "none" };

  const state = offerRoundState((offers ?? []).map((o) => ({ id: o.id, brokerOrgId: o.broker_org_id, status: o.status as "offered", round: o.round, respondsBy: o.responds_by })));
  if (state.state === "open" || state.state === "accepted") return { action: "none" };
  const nextRound = Math.max(state.round, routing.current_round) + 1;
  const ctx: RoundCtx = { routingId: routing.id, candidates: (routing.candidates as unknown as ConsideredBroker[]) ?? [], offerTimeoutMinutes: routing.offer_timeout_minutes, offerBatchSize: routing.offer_batch_size, maxRounds: routing.max_rounds };
  const offered = await offerRound(svc, req, ctx, nextRound, null);
  return offered.length ? { action: "offered", round: nextRound } : { action: "held", round: nextRound };
}

/** Cron: expire overdue offers, then re-route every pool request whose round is closed. */
export async function expireAndRerouteOffers(svc: Svc): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const { data: overdue } = await svc.from("order_offers").select("id, request_id, broker_org_id, round").eq("status", "offered").lt("responds_by", now).limit(500);
  let expired = 0;
  const touched = new Set<string>();
  for (const o of overdue ?? []) {
    const { data: done } = await svc.from("order_offers").update({ status: "expired", responded_at: now }).eq("id", o.id).eq("status", "offered").select("id");
    if (!done?.length) continue;
    expired++;
    touched.add(o.request_id);
    await svc.from("request_events").insert({ request_id: o.request_id, actor_party: "system", event: "offer_expired", visible_to_customer: false, data: { offer_id: o.id, broker_org_id: o.broker_org_id, round: o.round } as Json });
  }
  // Also pick up pool requests whose round closed by declines (no open offers, no broker) and
  // stale expires_at values, so a missed call-site never strands a request.
  const { data: stale } = await svc.from("order_routing").select("request_id").eq("mode", "broker_pool").not("expires_at", "is", null).lt("expires_at", now).limit(500);
  for (const r of stale ?? []) touched.add(r.request_id);

  let offered = 0;
  let held = 0;
  let withdrawn = 0;
  for (const requestId of touched) {
    try {
      const r = await rerouteIfRoundClosed(svc, requestId);
      if (r.action === "offered") offered++;
      else if (r.action === "held") held++;
      else if (r.action === "withdrawn") withdrawn++;
    } catch (err) {
      log.error("routing.reroute_failed", { requestId, err });
    }
  }
  return { expired, rerouted: offered, held, withdrawn, checked: touched.size };
}

// ---------------------------------------------------------------------------
// After a broker accepts
// ---------------------------------------------------------------------------
/**
 * Follow-ups once `accept_order_offer` has made the broker the broker of record: usage
 * metering, partner webhook, customer notification and (for integrated categories) the
 * first estimates. Safe to call more than once; failures are logged, never thrown.
 */
export async function afterOfferAccepted(svc: Svc, accepted: { request_id: string; broker_org_id: string; reference: string; customer_id: string }) {
  try {
    const { data: req } = await svc.from("requests").select("id, reference, status, type, source, customer_id, broker_org_id, category_id, risk_data, risk_fingerprint, category:product_categories(slug, name, availability)").eq("id", accepted.request_id).maybeSingle();
    if (!req) return;
    const category = req.category as unknown as { slug: string; name: string; availability: string } | null;
    const { data: brokerOrg } = await svc.from("organizations").select("name").eq("id", accepted.broker_org_id).maybeSingle();

    await svc.from("usage_events").upsert({ org_id: accepted.broker_org_id, metric: "request_processed", reference_id: req.id }, { onConflict: "org_id,metric,reference_id", ignoreDuplicates: true });

    let estimates = { quotes: 0, ready: 0 };
    if (category?.availability === "integrated" && req.status === "submitted") {
      try {
        // Lazy import: requests.ts imports this module (createRequest → routeNewRequest).
        const { generateEstimates } = await import("@/server/requests");
        estimates = await generateEstimates(svc, { id: req.id, broker_org_id: accepted.broker_org_id, category_id: req.category_id, risk_data: req.risk_data, risk_fingerprint: req.risk_fingerprint });
      } catch (err) {
        log.warn("routing.estimates_failed", { requestId: req.id, err });
      }
    }
    if (req.status === "submitted") {
      const nextStatus: Enum<"request_status"> = estimates.ready > 0 ? "quotes_ready" : estimates.quotes > 0 ? "insurer_response" : "adviser_action";
      const nextStep =
        nextStatus === "quotes_ready"
          ? "Compare your quotes. Some insurers are still confirming theirs."
          : nextStatus === "insurer_response"
            ? "Indicative estimates are ready. Insurers are confirming binding quotes."
            : `${brokerOrg?.name ?? "Your broker"} is reviewing your request.`;
      await svc.from("requests").update({ status: nextStatus, next_step: nextStep }).eq("id", req.id).eq("status", "submitted");
      await emitEvent(accepted.broker_org_id, "request.created", { request_id: req.id, reference: req.reference, status: nextStatus, type: req.type, category: category?.slug ?? null, source: req.source });
      if (nextStatus === "quotes_ready") await emitEvent(accepted.broker_org_id, "quote.ready", { request_id: req.id, reference: req.reference, quotes: estimates.quotes, binding: estimates.ready });
    } else {
      await emitEvent(accepted.broker_org_id, "request.created", { request_id: req.id, reference: req.reference, status: req.status, type: req.type, category: category?.slug ?? null, source: req.source });
    }
    await notify({
      userId: req.customer_id,
      kind: "request.broker_assigned",
      title: `${brokerOrg?.name ?? "A licensed broker"} is handling ${req.reference}`,
      body: `${brokerOrg?.name ?? "Your broker"} accepted your ${category?.name?.toLowerCase() ?? ""} request and is now your broker of record.`,
      link: `/account/requests/${req.id}`,
      data: { request_id: req.id, broker_org_id: accepted.broker_org_id },
      channels: ["in_app", "push", "email"],
    });
  } catch (err) {
    log.error("routing.after_accept_failed", { requestId: accepted.request_id, err });
  }
}
