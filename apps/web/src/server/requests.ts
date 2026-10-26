import "server-only";
import {
  ENGINE_VERSION,
  compareQuotes,
  ratePremium,
  riskFingerprint,
  riskSchemaToZod,
  riskTitle,
  routeRequest,
  type ComparableQuote,
  type RatingRule,
  type RiskField,
  type RoutingCandidate,
} from "@im/core";
import type { Enum, Json, Row } from "@im/db";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { notify, notifyOrg } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";

export class BusinessRuleError extends Error {
  constructor(message: string, public code = "business_rule") {
    super(message);
  }
}

type Service = ReturnType<typeof createServiceClient>;

/** Map Postgres trigger (P0001) errors to readable messages. */
export function ruleMessage(err: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong") {
  if (!err) return fallback;
  if (err.code === "P0001" && err.message) return err.message;
  if (err.code === "23505") return "This has already been submitted.";
  return fallback;
}

// ---------------------------------------------------------------------------
// Broker routing
// ---------------------------------------------------------------------------
export async function assignBroker(svc: Service, category: Pick<Row<"product_categories">, "id" | "segment">, ctx: { region?: string }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: rules } = await svc
    .from("broker_routing_rules")
    .select("broker_org_id, priority, is_secondary, regions, segments, daily_capacity, active, broker:organizations!broker_routing_rules_broker_org_id_fkey(id, name, status, nic_licence_number, nic_licence_expires_on)")
    .eq("category_id", category.id)
    .eq("active", true);

  const candidates: RoutingCandidate[] = [];
  for (const r of rules ?? []) {
    const broker = r.broker as unknown as Pick<Row<"organizations">, "id" | "name" | "status" | "nic_licence_number" | "nic_licence_expires_on"> | null;
    if (!broker) continue;
    const [{ count: openToday }, { count: insurerAccess }] = await Promise.all([
      svc.from("requests").select("id", { count: "exact", head: true }).eq("broker_org_id", broker.id).gte("created_at", today.toISOString()),
      svc.from("insurer_broker_appointments").select("id", { count: "exact", head: true }).eq("broker_org_id", broker.id).eq("category_id", category.id).eq("active", true),
    ]);
    candidates.push({
      brokerOrgId: broker.id,
      brokerName: broker.name,
      priority: r.priority,
      isSecondary: r.is_secondary,
      regions: r.regions,
      segments: r.segments,
      dailyCapacity: r.daily_capacity,
      openToday: openToday ?? 0,
      insurerAccess: insurerAccess ?? 0,
      licenceValid:
        broker.status === "active" &&
        !!broker.nic_licence_number &&
        (!broker.nic_licence_expires_on || new Date(broker.nic_licence_expires_on) >= today),
    });
  }
  return routeRequest(candidates, { region: ctx.region, segment: category.segment });
}

// ---------------------------------------------------------------------------
// Estimates & connector simulation
// ---------------------------------------------------------------------------
interface ProductWithVersion {
  id: string;
  name: string;
  insurer_org_id: string;
  insurer: Pick<Row<"organizations">, "id" | "name" | "integration_level"> | null;
  version: Row<"product_versions"> | null;
}

/**
 * Prices every approved product in the category whose insurer is appointed to the
 * broker. Insurers on a quote/policy API return binding quotes immediately
 * (simulated connector); portal insurers get an estimate plus a pending submission
 * for their staff to confirm. Records an auditable comparison run.
 */
export async function generateEstimates(svc: Service, req: Pick<Row<"requests">, "id" | "broker_org_id" | "category_id" | "risk_data" | "risk_fingerprint">) {
  if (!req.broker_org_id) return { quotes: 0, ready: 0 };

  const { data: appts } = await svc
    .from("insurer_broker_appointments")
    .select("insurer_org_id")
    .eq("broker_org_id", req.broker_org_id)
    .eq("category_id", req.category_id)
    .eq("active", true);
  const insurerIds = (appts ?? []).map((a) => a.insurer_org_id);
  if (!insurerIds.length) return { quotes: 0, ready: 0 };

  const { data: products } = await svc
    .from("products")
    .select("id, name, insurer_org_id, insurer:organizations!products_insurer_org_id_fkey(id, name, integration_level), version:product_versions!products_current_version_fk(*)")
    .eq("category_id", req.category_id)
    .eq("status", "approved")
    .in("insurer_org_id", insurerIds);

  const risk = (req.risk_data ?? {}) as Record<string, unknown>;
  const validity = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const comparable: ComparableQuote[] = [];
  let ready = 0;

  for (const p of (products ?? []) as unknown as ProductWithVersion[]) {
    const v = p.version;
    if (!v || v.status !== "approved") continue;
    const result = ratePremium(v.rating as unknown as RatingRule, risk);
    if (!result.ok || result.premium <= 0) continue;

    const apiConnected = p.insurer?.integration_level === "quote_api" || p.insurer?.integration_level === "policy_api";
    const status: Enum<"quote_status"> = apiConnected ? "ready_to_accept" : "estimate";
    const channel: Enum<"integration_level"> = p.insurer?.integration_level ?? "portal";

    // Dedupe registry: the unique index rejects a second live submission of the same risk to the same insurer.
    const { data: sub, error: subErr } = await svc
      .from("insurer_submissions")
      .insert({
        request_id: req.id,
        insurer_org_id: p.insurer_org_id,
        broker_org_id: req.broker_org_id,
        risk_fingerprint: req.risk_fingerprint ?? req.id,
        channel,
        status: apiConnected ? "quoted" : "pending",
        sent_at: new Date().toISOString(),
        responded_at: apiConnected ? new Date().toISOString() : null,
        response_due_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        idempotency_key: `${req.id}:${p.insurer_org_id}`,
      })
      .select("id")
      .single();
    if (subErr && subErr.code !== "23505") throw subErr;
    if (subErr) continue; // duplicate submission to this insurer — skip

    const excesses = (v.excesses ?? {}) as Record<string, unknown>;
    const mainExcess = Object.values(excesses).find((x) => typeof x === "number") as number | undefined;

    const { data: q, error: qErr } = await svc
      .from("quotes")
      .insert({
        request_id: req.id,
        submission_id: sub?.id,
        insurer_org_id: p.insurer_org_id,
        broker_org_id: req.broker_org_id,
        product_id: p.id,
        product_version_id: v.id,
        status,
        premium: result.premium,
        sum_insured: result.sumInsured,
        excess: mainExcess ?? null,
        limits: v.limits,
        excesses: v.excesses,
        coverage: v.coverage,
        exclusions: v.exclusions,
        key_exclusion: v.key_exclusion,
        waiting_period_days: v.waiting_period_days,
        optional_benefits: v.optional_benefits,
        conditions: v.conditions,
        assumptions: { rating_lines: result.lines, loadings: result.appliedLoadings, engine: ENGINE_VERSION } as unknown as Json,
        valid_until: apiConnected ? validity : null,
        commission_disclosure: "The broker of record may receive commission from the insurer. Ask your broker for details.",
      })
      .select("id")
      .single();
    if (qErr) throw qErr;
    if (status === "ready_to_accept") ready++;

    comparable.push({
      id: q.id,
      insurerId: p.insurer_org_id,
      insurerName: p.insurer?.name ?? "Insurer",
      productName: p.name,
      status,
      premium: result.premium,
      excess: mainExcess ?? null,
      sumInsured: result.sumInsured,
      coverage: (v.coverage as unknown as ComparableQuote["coverage"]) ?? [],
      exclusions: v.exclusions,
      keyExclusion: v.key_exclusion,
      waitingPeriodDays: v.waiting_period_days,
      optionalBenefits: (v.optional_benefits as unknown as ComparableQuote["optionalBenefits"]) ?? [],
    });
  }

  if (comparable.length) {
    const cmp = compareQuotes(comparable);
    await svc.from("recommendation_runs").insert({
      request_id: req.id,
      inputs: risk as Json,
      products_considered: comparable.map((c) => ({ quote_id: c.id, insurer: c.insurerName, product: c.productName, premium: c.premium, status: c.status })) as unknown as Json,
      insurers_compared: cmp.insurersCompared,
      criteria: cmp.criteria as unknown as Json,
      scores: cmp.ranked.map((r) => ({ quote_id: r.quote.id, score: r.score, breakdown: r.breakdown })) as unknown as Json,
      labels: Object.fromEntries(cmp.ranked.map((r) => [r.quote.id, r.labels])) as unknown as Json,
      material_exclusions: cmp.materialExclusions as unknown as Json,
      explanation: cmp.disclaimer,
      engine_version: ENGINE_VERSION,
    });
  }
  return { quotes: comparable.length, ready };
}

// ---------------------------------------------------------------------------
// Create request
// ---------------------------------------------------------------------------
export interface CreateRequestArgs {
  categorySlug: string;
  risk: Record<string, unknown>;
  type?: Enum<"request_type">;
  source?: Enum<"request_source">;
  relatedPolicyId?: string;
  needsAssessmentId?: string;
  submit?: boolean;
}

export async function createRequest(
  args: CreateRequestArgs,
  opts: {
    supabase?: Awaited<ReturnType<typeof createClient>>;
    /**
     * Verified user id when `supabase` is a bearer-token client (API v1 / mobile), which
     * has no cookie session for `auth.getUser()`. The caller must have verified the token.
     */
    userId?: string;
  } = {},
) {
  const supabase = opts.supabase ?? (await createClient());
  const svc = createServiceClient();

  let user: { id: string } | null = null;
  if (opts.userId && opts.supabase) {
    user = { id: opts.userId };
  } else {
    const { data: auth } = await supabase.auth.getUser();
    user = auth.user;
  }
  if (!user) throw new BusinessRuleError("Please sign in to continue.", "unauthorised");

  const { data: category } = await supabase.from("product_categories").select("*").eq("slug", args.categorySlug).single();
  if (!category) throw new BusinessRuleError("Unknown insurance category.", "not_found");
  if (category.availability === "planned") {
    throw new BusinessRuleError(`${category.name} is not available yet. We only open a category when advice, underwriting and servicing can support it.`);
  }

  const parsed = riskSchemaToZod(category.risk_schema as unknown as RiskField[]).safeParse(args.risk);
  if (!parsed.success) {
    throw new BusinessRuleError(parsed.error.issues.map((i) => i.message).join(" "), "invalid_input");
  }
  const risk = parsed.data as Record<string, unknown>;
  const fingerprint = await riskFingerprint({ customerId: user.id, categorySlug: category.slug, risk });

  const routing = await assignBroker(svc, category, { region: typeof risk.region === "string" ? risk.region : undefined });
  const submit = args.submit ?? true;
  const needsReview = category.availability === "broker_assisted" || category.segment !== "personal";

  const { data: request, error } = await supabase
    .from("requests")
    .insert({
      customer_id: user.id,
      category_id: category.id,
      type: args.type ?? "new_cover",
      status: submit ? "submitted" : "draft",
      source: args.source ?? "web",
      title: riskTitle(category.slug, risk),
      broker_org_id: routing.brokerOrgId,
      risk_data: risk as Json,
      risk_fingerprint: fingerprint,
      related_policy_id: args.relatedPolicyId ?? null,
      needs_assessment_id: args.needsAssessmentId ?? null,
      needs_adviser_review: needsReview,
      next_step: routing.brokerOrgId ? "Your broker is reviewing your request." : "We are assigning a broker to your request.",
    })
    .select("*")
    .single();
  if (error) throw new BusinessRuleError(ruleMessage(error, "We couldn't save your request."));

  await svc.from("request_events").insert({
    request_id: request.id,
    actor_party: "system",
    event: "routing_decision",
    visible_to_customer: false,
    data: routing as unknown as Json,
  });

  if (!submit) return { request, routing, estimates: { quotes: 0, ready: 0 } };

  // Document tasks for the customer
  const docs = category.required_documents ?? [];
  if (docs.length) {
    await svc.from("request_tasks").insert(
      docs.map((d) => ({
        request_id: request.id,
        kind: "document" as const,
        document_kind: d,
        title: `Upload your ${d.replace(/_/g, " ")}`,
        assignee_party: "customer" as const,
        due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      })),
    );
  }

  let estimates = { quotes: 0, ready: 0 };
  if (category.availability === "integrated" && routing.brokerOrgId) {
    estimates = await generateEstimates(svc, request);
  }

  // Status: binding quotes ready → quotes_ready; estimates only → insurer_response; assisted → adviser_action
  const nextStatus: Enum<"request_status"> = needsReview
    ? "adviser_action"
    : estimates.ready > 0
      ? "quotes_ready"
      : estimates.quotes > 0
        ? "insurer_response"
        : "adviser_action";
  const nextStep =
    nextStatus === "quotes_ready"
      ? "Compare your quotes. Some insurers are still confirming theirs."
      : nextStatus === "insurer_response"
        ? "Indicative estimates are ready. Insurers are confirming binding quotes."
        : "Your adviser is reviewing your request.";
  await svc.from("requests").update({ status: nextStatus, next_step: nextStep }).eq("id", request.id);

  if (routing.brokerOrgId) {
    await svc.from("usage_events").upsert(
      { org_id: routing.brokerOrgId, metric: "request_processed", reference_id: request.id },
      { onConflict: "org_id,metric,reference_id", ignoreDuplicates: true },
    );
    // Notify broker team
    await notifyOrg(routing.brokerOrgId, {
      kind: "request.new",
      title: `New ${category.name.toLowerCase()} request ${request.reference}`,
      body: request.title ?? undefined,
      link: `/partner/requests/${request.id}`,
      data: { request_id: request.id },
      channels: ["in_app", "email", "push"],
    });
  }
  if (routing.brokerOrgId) {
    await emitEvent(routing.brokerOrgId, "request.created", { request_id: request.id, reference: request.reference, status: nextStatus, type: request.type, category: category.slug, source: request.source });
    if (nextStatus === "quotes_ready") await emitEvent(routing.brokerOrgId, "quote.ready", { request_id: request.id, reference: request.reference, quotes: estimates.quotes, binding: estimates.ready });
  }
  await notify({
    userId: user.id,
    kind: nextStatus === "quotes_ready" ? "quote.ready" : "request.created",
    title: nextStatus === "quotes_ready" ? `Quotes ready for ${request.reference}` : `Request ${request.reference} received`,
    body: nextStep,
    link: nextStatus === "quotes_ready" ? `/account/requests/${request.id}/quotes` : `/account/requests/${request.id}`,
    data: { request_id: request.id },
    channels: ["in_app", "push", "email"],
  });

  return { request: { ...request, status: nextStatus, next_step: nextStep }, routing, estimates };
}
