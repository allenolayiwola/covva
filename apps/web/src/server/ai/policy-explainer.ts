import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  EXPLAINER_ADVISORY_NOTE,
  EXPLAINER_DISCLAIMER,
  EXPLAINER_NOT_FOUND,
  EXPLAINER_SUGGESTIONS,
  OPEN_REQUEST_STATUSES,
  POLICY_STATUS,
  buildExplainerPrompt,
  buildGrounding,
  buildHandoffMessage,
  buildSummaryPrompt,
  classifyQuestion,
  defaultTemplate,
  fallbackSummary,
  groupClauses,
  searchClauses,
  templateText,
  validateCitations,
  type CheckedStatement,
  type DocumentTemplate,
  type Grounding,
  type GroundingClause,
  type QuestionClass,
} from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { notFound, rule, type UserClient } from "@/server/api-auth";
import { log } from "@/server/log";
import { notifyOrg } from "@/server/notify";
import { aiFlagOn, getModels } from "./config";
import { AI_LABEL, BASE_INSTRUCTIONS, redactPII } from "./guardrails";
import { logAiUsage } from "./usage";

/**
 * Policy explainer (Addendum 6.3). Answers questions about ONE policy from its own schedule and
 * wording only (`@im/core` buildGrounding), cites clause ids that are checked server-side, and hands
 * advisory questions to the broker of record on the existing request thread.
 *
 * Access: the policy must be readable by the caller under RLS AND the caller must be on the
 * policyholder side (customer, sponsor or linked beneficiary). Once that is established, the wording
 * (product version, quote terms, approved templates) is read with the service client, scoped to the
 * ids on that policy — the same pattern as the claim completeness check.
 *
 * Without the AI Gateway (or with the `ai_assistant` flag off) everything still works except AI
 * answers: the clause browser, keyword matches, a schedule-based summary and the broker hand-off.
 */

export type ExplainerViewer = "owner" | "sponsor" | "beneficiary";

export interface ExplainerBroker { id: string; name: string; phone: string | null; email: string | null }

export interface ExplainerContext {
  policyId: string;
  viewer: ExplainerViewer;
  grounding: Grounding;
  productVersionId: string | null;
  broker: ExplainerBroker | null;
  demo: boolean;
  wordingUrl: string | null;
  /** Request thread with the broker of record that the caller can post on, if any. */
  thread: { requestId: string; reference: string } | null;
}

type Svc = ReturnType<typeof createServiceClient>;

const POLICY_COLS =
  "id, customer_id, sponsor_user_id, beneficiary_id, request_id, quote_id, product_version_id, broker_org_id, internal_reference, policy_number, status, cover_start, cover_end, premium, billing_period, sum_insured, excess, insured_items, external_source, external_insurer_name, summary, issued_at, category:product_categories(name, slug), insurer:organizations!policies_insurer_org_id_fkey(name, nic_licence_number, settings), broker:organizations!policies_broker_org_id_fkey(id, name, nic_licence_number, contact_phone, contact_email, settings)";

type OrgRef = { id?: string; name: string; nic_licence_number?: string | null; contact_phone?: string | null; contact_email?: string | null; settings?: Record<string, unknown> | null } | null;

/** Documents issued under policies/<id>/ that carry wording text (receipts and stickers don't). */
const DOC_TEMPLATE_KIND: Record<string, "schedule" | "certificate"> = { policy_schedule: "schedule", certificate: "certificate" };
const DOC_TITLE: Record<"schedule" | "certificate", string> = { schedule: "Policy schedule", certificate: "Certificate of insurance" };

function svcOrNull(): Svc | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

async function approvedTemplates(svc: Svc, productVersionId: string | null) {
  const out = new Map<string, DocumentTemplate>();
  if (!productVersionId) return out;
  const { data } = await svc
    .from("document_templates")
    .select("kind, template, version")
    .eq("product_version_id", productVersionId)
    .eq("status", "approved")
    .in("kind", ["schedule", "certificate"])
    .order("version", { ascending: false });
  for (const t of data ?? []) if (!out.has(t.kind)) out.set(t.kind, t.template as unknown as DocumentTemplate);
  return out;
}

async function findThread(sb: UserClient, userId: string, policy: { id: string; request_id: string | null; broker_org_id: string | null }) {
  if (!policy.broker_org_id) return null;
  // 1. An open request about this policy (renewal, change, service) with the same broker.
  const { data: open } = await sb
    .from("requests")
    .select("id, reference")
    .eq("related_policy_id", policy.id)
    .eq("customer_id", userId)
    .eq("broker_org_id", policy.broker_org_id)
    .in("status", OPEN_REQUEST_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  if (open?.[0]) return { requestId: open[0].id, reference: open[0].reference };
  // 2. The request the policy came from ("Message your broker" on the policy page uses this thread).
  if (policy.request_id) {
    const { data: r } = await sb.from("requests").select("id, reference, customer_id, broker_org_id").eq("id", policy.request_id).maybeSingle();
    if (r && r.customer_id === userId && r.broker_org_id === policy.broker_org_id) return { requestId: r.id, reference: r.reference };
  }
  return null;
}

/** Loads the grounding set for a policy the caller holds, sponsors or is the linked beneficiary of. */
export async function loadExplainerContext(sb: UserClient, userId: string, policyId: string): Promise<ExplainerContext> {
  const { data: policy } = await sb.from("policies").select(POLICY_COLS).eq("id", policyId).maybeSingle();
  if (!policy) throw notFound("Policy not found.");

  let viewer: ExplainerViewer | null = policy.customer_id === userId ? "owner" : policy.sponsor_user_id === userId ? "sponsor" : null;
  if (!viewer && policy.beneficiary_id) {
    const { data: b } = await sb.from("beneficiaries").select("id").eq("id", policy.beneficiary_id).eq("linked_user_id", userId).maybeSingle();
    if (b) viewer = "beneficiary";
  }
  // Brokers, insurers, staff and business admins have the wording itself; this endpoint is for policyholders.
  if (!viewer) throw notFound("Policy not found.");

  const insurer = policy.insurer as unknown as OrgRef;
  const broker = policy.broker as unknown as OrgRef;
  const category = policy.category as unknown as { name: string; slug: string } | null;
  const svc = svcOrNull();

  let quote: Record<string, unknown> | null = null;
  let version: Record<string, unknown> | null = null;
  let productName: string | null = null;
  let versionNumber: number | null = null;
  const documents: { kind: string; title: string; text: string }[] = [];
  if (svc && !policy.external_source) {
    const [q, v, docs, templates] = await Promise.all([
      policy.quote_id
        ? svc.from("quotes").select("coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions").eq("id", policy.quote_id).maybeSingle()
        : Promise.resolve({ data: null }),
      policy.product_version_id
        ? svc
            .from("product_versions")
            .select("version, coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, claims_process, wording_url, product:products!product_versions_product_id_fkey(name)")
            .eq("id", policy.product_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      svc.from("documents").select("kind, storage_path").eq("policy_id", policy.id).like("storage_path", `policies/${policy.id}/%`),
      approvedTemplates(svc, policy.product_version_id),
    ]);
    quote = (q.data as Record<string, unknown> | null) ?? null;
    version = (v.data as Record<string, unknown> | null) ?? null;
    productName = (version?.product as { name?: string } | null)?.name ?? null;
    versionNumber = typeof version?.version === "number" ? version.version : null;

    // Issued schedule / certificate text, re-rendered from the template they were issued with. The
    // customer's identity and the risk details are not passed in: "the policyholder" stands in.
    const issued = new Set((docs.data ?? []).map((d) => DOC_TEMPLATE_KIND[d.kind]).filter(Boolean) as ("schedule" | "certificate")[]);
    for (const kind of ["schedule", "certificate"] as const) {
      if (!issued.has(kind)) continue;
      const text = templateText(templates.get(kind) ?? defaultTemplate(kind), {
        kind: DOC_TITLE[kind].toLowerCase(),
        policy: { policy_number: "shown on your schedule", internal_reference: policy.internal_reference, cover_start: policy.cover_start, cover_end: policy.cover_end, premium: policy.premium, sum_insured: policy.sum_insured, excess: policy.excess, issued_at: policy.issued_at, summary: policy.summary },
        customer: { full_name: "the policyholder" },
        insurer: { name: insurer?.name ?? "the insurer", nic_licence_number: insurer?.nic_licence_number ?? null },
        product: { name: productName ?? policy.summary ?? category?.name ?? "this policy", version: versionNumber },
        category: category ? { name: category.name } : null,
        broker: broker ? { name: broker.name, nic_licence_number: broker.nic_licence_number ?? null } : null,
        risk: {},
      });
      if (text) documents.push({ kind, title: DOC_TITLE[kind], text });
    }
  }

  // The policy page shows quote terms when there is a quote, otherwise the product version.
  const terms = quote ?? version;
  const grounding = buildGrounding({
    policy: {
      reference: policy.internal_reference,
      policyNumber: policy.policy_number,
      status: policy.status,
      statusLabel: policy.external_source && policy.status === "active" ? "Added by you" : POLICY_STATUS[policy.status].label,
      coverStart: policy.cover_start,
      coverEnd: policy.cover_end,
      premium: policy.premium,
      billingPeriod: policy.billing_period,
      sumInsured: policy.sum_insured,
      excess: policy.excess,
      categoryName: category?.name ?? null,
      productName: productName ?? policy.summary ?? null,
      insurerName: insurer?.name ?? policy.external_insurer_name ?? null,
      brokerName: broker?.name ?? null,
      externalSource: policy.external_source,
      insuredItems: policy.insured_items,
    },
    terms: terms
      ? {
          coverage: terms.coverage,
          limits: terms.limits,
          excesses: terms.excesses,
          exclusions: (terms.exclusions as string[] | null) ?? [],
          keyExclusion: (terms.key_exclusion as string | null) ?? null,
          waitingPeriodDays: (terms.waiting_period_days as number | null) ?? 0,
          optionalBenefits: terms.optional_benefits,
          conditions: ((terms.conditions as string | null) ?? (version?.conditions as string | null)) || null,
          claimsProcess: (version?.claims_process as string | null) ?? null,
        }
      : null,
    documents,
  });

  const thread = viewer === "owner" ? await findThread(sb, userId, policy) : null;
  return {
    policyId: policy.id,
    viewer,
    grounding,
    productVersionId: policy.product_version_id,
    broker: broker?.id ? { id: broker.id, name: broker.name, phone: broker.contact_phone ?? null, email: broker.contact_email ?? null } : null,
    demo: !!(insurer?.settings as { demo?: boolean } | null)?.demo,
    wordingUrl: typeof version?.wording_url === "string" && /^https:\/\//i.test(version.wording_url) ? version.wording_url : null,
    thread,
  };
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------
export function handoffInfo(ctx: ExplainerContext) {
  return {
    available: !!ctx.thread && !!ctx.broker,
    brokerName: ctx.broker?.name ?? null,
    threadHref: ctx.thread ? `/account/requests/${ctx.thread.requestId}/messages` : null,
    reason: !ctx.broker
      ? "This policy has no broker of record on Covva. Contact your insurer directly."
      : !ctx.thread
        ? ctx.viewer === "owner"
          ? "There is no message thread with your broker for this policy yet. Call or email them using the details on this page."
          : "Only the policyholder can message the broker from here. Call or email them using the details on this page."
        : null,
  };
}

export async function explainerAvailability() {
  return { aiAvailable: await aiFlagOn("ai_assistant") };
}

export async function explainerClauses(ctx: ExplainerContext) {
  const { aiAvailable } = await explainerAvailability();
  return {
    policyId: ctx.policyId,
    versionKey: ctx.grounding.versionKey,
    policyRef: ctx.grounding.policyRef,
    groups: groupClauses(ctx.grounding),
    aiAvailable,
    demo: ctx.demo,
    wordingUrl: ctx.wordingUrl,
    suggestions: EXPLAINER_SUGGESTIONS,
    handoff: handoffInfo(ctx),
    disclaimer: EXPLAINER_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Model output schemas (validated again by validateCitations)
// ---------------------------------------------------------------------------
const Statement = z.object({
  text: z.string().describe("One short factual statement in plain words"),
  citations: z.array(z.string()).describe("Clause ids from <policy_wording> that support this statement (at least one)"),
  quote: z.string().nullable().describe("Optional: words copied exactly from the first cited clause"),
});
const Answer = z.object({
  status: z.enum(["answered", "not_in_wording"]),
  statements: z.array(Statement).max(8),
  needsBroker: z.boolean().describe("True when the question needs advice or a judgement about a specific situation"),
});
const Summary = z.object({ points: z.array(Statement).min(1).max(6) });

function isMissingTable(err: { code?: string } | null | undefined) {
  return err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "PGRST204";
}

// ---------------------------------------------------------------------------
// "Your cover in plain words" (cached per policy + wording version)
// ---------------------------------------------------------------------------
export interface ExplainerSummary { statements: CheckedStatement[]; source: "cache" | "generated" | "fallback"; aiAssisted: boolean; label: string; generatedAt: string | null }

export async function cachedSummary(sb: UserClient, ctx: ExplainerContext): Promise<ExplainerSummary | null> {
  const { data, error } = await sb
    .from("policy_explainer_summaries")
    .select("summary, created_at")
    .eq("policy_id", ctx.policyId)
    .eq("wording_hash", ctx.grounding.versionKey)
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) log.warn("explainer.summary_read_failed", { policyId: ctx.policyId, err: error });
    return null;
  }
  if (!data || !Array.isArray(data.summary)) return null;
  return { statements: data.summary as unknown as CheckedStatement[], source: "cache", aiAssisted: true, label: AI_LABEL, generatedAt: data.created_at };
}

function scheduleSummary(ctx: ExplainerContext): ExplainerSummary {
  return { statements: fallbackSummary(ctx.grounding), source: "fallback", aiAssisted: false, label: "Key facts from your schedule", generatedAt: null };
}

export async function explainerSummary(sb: UserClient, userId: string, ctx: ExplainerContext): Promise<ExplainerSummary> {
  const cached = await cachedSummary(sb, ctx);
  if (cached) return cached;
  if (!(await aiFlagOn("ai_assistant"))) return scheduleSummary(ctx);

  const models = await getModels();
  const parts = buildSummaryPrompt(ctx.grounding);
  const started = Date.now();
  let statements: CheckedStatement[];
  try {
    const { output, usage } = await generateText({
      model: models.fast,
      instructions: `${BASE_INSTRUCTIONS}\n\n${parts.instructions}`,
      prompt: parts.prompt,
      output: Output.object({ schema: Summary }),
    });
    await logAiUsage({ feature: "policy_explainer_summary", model: models.fast, usage, latencyMs: Date.now() - started, success: true, userId });
    statements = validateCitations({ status: "answered", statements: output.points }, ctx.grounding).statements;
  } catch (err) {
    log.warn("explainer.summary_failed", { policyId: ctx.policyId, err });
    await logAiUsage({ feature: "policy_explainer_summary", model: models.fast, latencyMs: Date.now() - started, success: false, userId });
    return scheduleSummary(ctx);
  }
  if (!statements.length) return scheduleSummary(ctx);

  const svc = svcOrNull();
  if (svc) {
    const { error } = await svc.from("policy_explainer_summaries").upsert(
      { policy_id: ctx.policyId, product_version_id: ctx.productVersionId, wording_hash: ctx.grounding.versionKey, summary: statements as unknown as Json, model: models.fast },
      { onConflict: "policy_id,wording_hash", ignoreDuplicates: true },
    );
    if (error && !isMissingTable(error)) log.warn("explainer.summary_store_failed", { policyId: ctx.policyId, err: error });
  }
  return { statements, source: "generated", aiAssisted: true, label: AI_LABEL, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------
async function writeLog(row: {
  userId: string;
  ctx: ExplainerContext;
  question: string;
  cls: QuestionClass;
  outcome: "answered" | "not_in_wording" | "clauses_only" | "error";
  statements?: CheckedStatement[];
  citedIds?: string[];
  droppedIds?: string[];
  model?: string | null;
}): Promise<string | null> {
  const svc = svcOrNull();
  if (!svc) return null;
  const answer = (row.statements ?? []).map((s) => s.text).join("\n").slice(0, 4000) || null;
  const { data, error } = await svc
    .from("policy_explainer_logs")
    .insert({
      user_id: row.userId,
      policy_id: row.ctx.policyId,
      wording_hash: row.ctx.grounding.versionKey,
      question: row.question.slice(0, 1000),
      classification: row.cls.kind,
      outcome: row.outcome,
      answer_text: answer,
      cited_ids: (row.citedIds ?? []).slice(0, 50),
      dropped_ids: (row.droppedIds ?? []).slice(0, 50).map((d) => d.slice(0, 120)),
      ai_assisted: row.outcome === "answered" || row.outcome === "not_in_wording",
      model: row.model ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (!isMissingTable(error)) log.warn("explainer.log_failed", { policyId: row.ctx.policyId, err: error });
    return null;
  }
  return data.id;
}

const clauseMatch = (c: GroundingClause) => ({ id: c.id, heading: c.heading, group: c.group, text: c.text });

export async function explainQuestion(userId: string, ctx: ExplainerContext, rawQuestion: string) {
  const question = redactPII(rawQuestion).trim().slice(0, 500);
  const heuristic = classifyQuestion(question);
  const base = { disclaimer: EXPLAINER_DISCLAIMER, handoff: handoffInfo(ctx), question };

  const clausesOnly = async (reason: "no_ai" | "ai_error") => {
    const matches = searchClauses(ctx.grounding, question, 5);
    const logId = await writeLog({ userId, ctx, question, cls: heuristic, outcome: reason === "ai_error" ? "error" : "clauses_only", citedIds: matches.map((m) => m.id) });
    return {
      ...base,
      mode: "clauses_only" as const,
      logId,
      advisory: heuristic.kind === "advisory",
      reasons: heuristic.reasons,
      status: "not_in_wording" as const,
      statements: [] as CheckedStatement[],
      matches: matches.map(clauseMatch),
      notice:
        reason === "ai_error"
          ? "We couldn't write an answer just now. These parts of your wording look related — or ask your broker."
          : "Written answers aren't available here at the moment. These parts of your wording look related — or ask your broker.",
      aiAssisted: false,
      label: null,
    };
  };

  if (!(await aiFlagOn("ai_assistant"))) return clausesOnly("no_ai");

  const models = await getModels();
  const parts = buildExplainerPrompt(ctx.grounding, question, heuristic);
  const started = Date.now();
  try {
    const { output, usage } = await generateText({
      model: models.default,
      instructions: `${BASE_INSTRUCTIONS}\n\n${parts.instructions}`,
      prompt: parts.prompt,
      output: Output.object({ schema: Answer }),
    });
    await logAiUsage({ feature: "policy_explainer", model: models.default, usage, latencyMs: Date.now() - started, success: true, userId });
    const checked = validateCitations(output, ctx.grounding);
    if (checked.droppedIds.length || checked.removedStatements) {
      log.info("explainer.citations_dropped", { policyId: ctx.policyId, dropped: checked.droppedIds.length, removedStatements: checked.removedStatements });
    }
    const advisory = heuristic.kind === "advisory" || checked.needsBroker;
    const cls: QuestionClass = advisory && heuristic.kind !== "advisory" ? { kind: "advisory", reasons: ["needs a judgement about your situation"] } : heuristic;
    const logId = await writeLog({ userId, ctx, question, cls, outcome: checked.status, statements: checked.statements, citedIds: checked.citedIds, droppedIds: checked.droppedIds, model: models.default });
    return {
      ...base,
      mode: "ai" as const,
      logId,
      advisory,
      reasons: cls.reasons,
      status: checked.status,
      statements: checked.statements,
      matches: checked.status === "not_in_wording" ? searchClauses(ctx.grounding, question, 3).map(clauseMatch) : [],
      notice: checked.status === "not_in_wording" ? EXPLAINER_NOT_FOUND : advisory ? EXPLAINER_ADVISORY_NOTE : null,
      aiAssisted: true,
      label: AI_LABEL,
    };
  } catch (err) {
    log.warn("explainer.ask_failed", { policyId: ctx.policyId, err });
    await logAiUsage({ feature: "policy_explainer", model: models.default, latencyMs: Date.now() - started, success: false, userId });
    return clausesOnly("ai_error");
  }
}

// ---------------------------------------------------------------------------
// Broker hand-off: a customer message on the request thread with the broker of record
// ---------------------------------------------------------------------------
export async function handoffToBroker(sb: UserClient, userId: string, ctx: ExplainerContext, input: { question: string; clauseIds: string[]; logId?: string }) {
  const info = handoffInfo(ctx);
  if (!info.available || !ctx.thread || !ctx.broker) throw rule(info.reason ?? "We couldn't reach your broker from here.");
  const question = redactPII(input.question).trim().slice(0, 500);
  const wanted = new Set(input.clauseIds.map((id) => id.trim().toLowerCase()));
  const clauses = ctx.grounding.clauses.filter((c) => wanted.has(c.id.toLowerCase()));
  const body = buildHandoffMessage({ question, policyRef: ctx.grounding.policyRef, clauses, reasons: classifyQuestion(question).reasons });

  const { data: msg, error } = await sb
    .from("request_messages")
    .insert({ request_id: ctx.thread.requestId, sender_id: userId, sender_party: "customer", body, internal: false })
    .select("id, created_at")
    .single();
  if (error || !msg) {
    log.warn("explainer.handoff_failed", { policyId: ctx.policyId, err: error });
    throw rule("Your question didn't reach your broker. Please try again, or use the broker's contact details.");
  }
  await notifyOrg(ctx.broker.id, {
    kind: "message.new",
    title: `Policy question on ${ctx.thread.reference}`,
    body: question.length > 140 ? `${question.slice(0, 137)}…` : question,
    link: `/partner/requests/${ctx.thread.requestId}`,
    data: { request_id: ctx.thread.requestId, message_id: msg.id, policy_id: ctx.policyId, source: "policy_explainer" },
    channels: ["in_app", "push"],
  }).catch(() => {});

  if (input.logId) {
    const svc = svcOrNull();
    if (svc) {
      const { error: upErr } = await svc
        .from("policy_explainer_logs")
        .update({ handoff_request_id: ctx.thread.requestId, handoff_message_id: msg.id, handed_off_at: new Date().toISOString() })
        .eq("id", input.logId)
        .eq("user_id", userId)
        .eq("policy_id", ctx.policyId);
      if (upErr && !isMissingTable(upErr)) log.warn("explainer.handoff_log_failed", { policyId: ctx.policyId, err: upErr });
    }
  }
  return {
    sent: true,
    requestId: ctx.thread.requestId,
    messageId: msg.id,
    threadHref: `/account/requests/${ctx.thread.requestId}/messages`,
    brokerName: ctx.broker.name,
    clauseIds: clauses.map((c) => c.id),
  };
}
