import "server-only";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { AssistantRequest, LABELS, POLICY_STATUS, REQUEST_STATUS, assessNeeds, compareQuotes, comparisonSummary } from "@im/core";
import type { Json } from "@im/db";
import { getCategories } from "@/lib/catalog";
import { notFound, parseJson, type ApiCtx, type UserAuth } from "@/server/api-auth";
import { loadQuotesForRequest, toComparable, type QuoteWithParties } from "@/server/quotes";
import { log } from "@/server/log";
import { getModels, requireAiFeature } from "./config";
import { AI_LABEL, BASE_INSTRUCTIONS, redactPII } from "./guardrails";
import { lookupTerm, GLOSSARY } from "./glossary";
import { logAiUsage } from "./usage";

/**
 * Customer assistant (streaming chat). Tools are read-only and use the caller's
 * RLS-scoped Supabase client, so the model can only see what the customer can see.
 */
function customerTools(auth: UserAuth) {
  const sb = auth.supabase;
  return {
    listMyPolicies: tool({
      description: "List the customer's policies with status, insurer, category and cover dates.",
      inputSchema: z.object({ status: z.enum(["pending_issuance", "active", "lapsed", "cancelled", "expired", "renewed"]).optional() }),
      execute: async ({ status }) => {
        let q = sb
          .from("policies")
          .select("id, internal_reference, policy_number, status, nickname, cover_start, cover_end, premium, billing_period, external_source, category:product_categories(name), insurer:organizations!policies_insurer_org_id_fkey(name)")
          .eq("customer_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (status) q = q.eq("status", status);
        const { data } = await q;
        return (data ?? []).map((p) => ({
          ...p,
          statusLabel: POLICY_STATUS[p.status].label,
          statusHint: POLICY_STATUS[p.status].customerHint ?? null,
        }));
      },
    }),
    getPolicyDetails: tool({
      description: "Get cover, limits, excesses, exclusions and waiting period for one of the customer's policies.",
      inputSchema: z.object({ policyId: z.string().uuid() }),
      execute: async ({ policyId }) => {
        const { data: p } = await sb
          .from("policies")
          .select("id, internal_reference, policy_number, status, cover_start, cover_end, premium, sum_insured, excess, external_source, category:product_categories(name, slug), insurer:organizations!policies_insurer_org_id_fkey(name), broker:organizations!policies_broker_org_id_fkey(name), version:product_versions(coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, claims_process)")
          .eq("id", policyId)
          .maybeSingle();
        if (!p) return { error: "Policy not found." };
        return { ...p, statusLabel: POLICY_STATUS[p.status].label, statusHint: POLICY_STATUS[p.status].customerHint ?? null };
      },
    }),
    getRequestStatus: tool({
      description: "Get the status, next step and open tasks for a request. Without an id, returns the customer's most recent requests.",
      inputSchema: z.object({ requestId: z.string().uuid().optional() }),
      execute: async ({ requestId }) => {
        let q = sb
          .from("requests")
          .select("id, reference, status, title, next_step, type, created_at, due_at, category:product_categories(name), broker:organizations!requests_broker_org_id_fkey(name), tasks:request_tasks(title, kind, status, due_at, assignee_party)")
          .eq("customer_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(requestId ? 1 : 5);
        if (requestId) q = q.eq("id", requestId);
        const { data } = await q;
        return (data ?? []).map((r) => ({
          ...r,
          statusLabel: REQUEST_STATUS[r.status].label,
          statusHint: REQUEST_STATUS[r.status].customerHint ?? null,
          tasks: (r.tasks ?? []).filter((t) => t.status === "open"),
        }));
      },
    }),
    explainQuoteComparison: tool({
      description: "Get the quotes for a request and the comparison result (criteria, labels, reasons, key exclusions) so you can explain the trade-offs. Do not choose for the customer.",
      inputSchema: z.object({ requestId: z.string().uuid() }),
      execute: async ({ requestId }) => {
        const r = await loadQuotesForRequest(sb, requestId);
        if (!r || (await isNotOwner(auth, requestId))) return { error: "Request not found." };
        const cmp = compareQuotes(r.quotes.map((q) => toComparable(q as unknown as QuoteWithParties)));
        return {
          summary: comparisonSummary(cmp),
          criteria: cmp.criteria,
          disclaimer: cmp.disclaimer,
          quotes: cmp.ranked.map((s) => ({
            insurer: s.quote.insurerName,
            product: s.quote.productName,
            status: s.quote.status,
            premium: s.quote.premium,
            excess: s.quote.excess,
            sumInsured: s.quote.sumInsured,
            coverageItems: s.coverageCount,
            keyExclusion: s.quote.keyExclusion,
            waitingPeriodDays: s.quote.waitingPeriodDays,
            validUntil: s.quote.validUntil,
            labels: s.labels.map((l) => LABELS[l]),
            reasons: s.reasons,
          })),
          paidPlacementsShownSeparately: cmp.paidPlacements.length,
          disclosure: r.disclosure,
        };
      },
    }),
    explainTerm: tool({
      description: "Look up a plain-language definition of an insurance term (excess, sum insured, exclusions, waiting period, no-claims discount, third party, etc.).",
      inputSchema: z.object({ term: z.string().min(2).max(60) }),
      execute: async ({ term }) => lookupTerm(term) ?? { error: "Not in the glossary.", knownTerms: Object.values(GLOSSARY).map((g) => g.term) },
    }),
    findCategoryForNeed: tool({
      description: "Suggest insurance categories for a described need using the platform's needs assessment. Map what the customer said to these answers; leave unknowns out.",
      inputSchema: z.object({
        who: z.enum(["me", "family", "business"]).optional(),
        work: z.enum(["employed", "self_employed", "informal", "professional", "business_owner", "not_working"]).optional(),
        assets: z.array(z.enum(["vehicle", "home_owned", "home_rented", "shop", "goods_transit", "none"])).optional(),
        dependants: z.boolean().optional(),
        travel: z.boolean().optional(),
        health_cover: z.enum(["nhis_only", "employer", "private", "none"]).optional(),
        advice_on_claims: z.boolean().optional(),
      }),
      execute: async (answers) => {
        const result = assessNeeds(answers);
        const cats = await getCategories();
        return {
          ...result,
          suggestions: result.suggestions.map((s) => {
            const c = cats.find((x) => x.slug === s.slug);
            return { ...s, name: c?.name ?? s.slug, availability: c?.availability ?? "planned" };
          }),
          note: "These are categories to consider, not a recommendation of a product. The broker of record advises on suitability.",
        };
      },
    }),
    draftMessageToBroker: tool({
      description: "Prepare a draft message from the customer to their broker about a request. Pass the full draft text you wrote. This does NOT send anything — the customer reviews and sends it themselves.",
      inputSchema: z.object({ requestId: z.string().uuid(), draft: z.string().min(5).max(2000) }),
      execute: async ({ requestId, draft }) => {
        const { data: r } = await sb
          .from("requests")
          .select("id, reference, customer_id, broker:organizations!requests_broker_org_id_fkey(name)")
          .eq("id", requestId)
          .maybeSingle();
        if (!r || r.customer_id !== auth.userId) return { error: "Request not found." };
        return {
          requestId: r.id,
          reference: r.reference,
          to: (r.broker as unknown as { name: string } | null)?.name ?? "your broker",
          draft: redactPII(draft),
          sent: false,
          label: "AI draft — review before sending",
          howToSend: "Open the request's messages, check the draft and press Send.",
        };
      },
    }),
  };
}

async function isNotOwner(auth: UserAuth, requestId: string) {
  const { data } = await auth.supabase.from("requests").select("customer_id").eq("id", requestId).maybeSingle();
  return data?.customer_id !== auth.userId;
}

function sanitiseMessages(raw: unknown[]): UIMessage[] {
  // Client-supplied system messages are dropped; user text is redacted of identifiers.
  return (raw as UIMessage[])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-30)
    .map((m, i) => ({
      ...m,
      id: m.id || `m${i}`,
      parts: (m.parts ?? [])
        .filter((p) => m.role === "assistant" || p.type === "text")
        .map((p) => (p.type === "text" && m.role === "user" ? { ...p, text: redactPII(p.text).slice(0, 4000) } : p)),
    }));
}

function firstUserText(messages: UIMessage[]) {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const t = m.parts.find((p) => p.type === "text");
    if (t && t.type === "text") return t.text.slice(0, 80);
  }
  return "Conversation";
}

export async function assistantHandler(ctx: ApiCtx<"user">): Promise<Response> {
  const auth = ctx.auth;
  const body = await parseJson(ctx.req, AssistantRequest);
  await requireAiFeature("ai_assistant");
  const models = await getModels();
  const messages = sanitiseMessages(body.messages);

  // Optional page context (RLS-scoped; ids/status only, no personal data).
  const context: string[] = [];
  if (body.requestId) {
    const { data: r } = await auth.supabase
      .from("requests")
      .select("id, reference, status, next_step, customer_id, category:product_categories(name), broker:organizations!requests_broker_org_id_fkey(name, nic_licence_number)")
      .eq("id", body.requestId)
      .maybeSingle();
    if (!r || r.customer_id !== auth.userId) throw notFound("Request not found.");
    const broker = r.broker as unknown as { name: string; nic_licence_number: string | null } | null;
    context.push(
      `The customer is looking at request ${r.reference} (id ${r.id}) for ${(r.category as unknown as { name: string } | null)?.name ?? "insurance"}. Status: ${REQUEST_STATUS[r.status].label}. Next step: ${r.next_step ?? "—"}. Broker of record: ${broker ? `${broker.name}${broker.nic_licence_number ? ` (NIC licence ${broker.nic_licence_number})` : ""}` : "not yet assigned"}.`,
    );
  }
  if (body.policyId) {
    const { data: p } = await auth.supabase.from("policies").select("id, internal_reference, status, customer_id").eq("id", body.policyId).maybeSingle();
    if (!p || p.customer_id !== auth.userId) throw notFound("Policy not found.");
    context.push(`The customer is looking at policy ${p.internal_reference} (id ${p.id}), status ${POLICY_STATUS[p.status].label}.`);
  }

  // Thread persistence (RLS: own threads only).
  let threadId = body.threadId ?? null;
  if (threadId) {
    const { data: t } = await auth.supabase.from("ai_threads").select("id").eq("id", threadId).maybeSingle();
    if (!t) threadId = null;
  }
  if (!threadId) {
    const { data: t } = await auth.supabase
      .from("ai_threads")
      .insert({ user_id: auth.userId, request_id: body.requestId ?? null, surface: "customer_assistant", title: redactPII(firstUserText(messages)) })
      .select("id")
      .single();
    threadId = t?.id ?? null;
  }

  const started = Date.now();
  const instructions = `${BASE_INSTRUCTIONS}

Your job here: help a customer understand their requests, quotes, policies and insurance terms. Use the tools to look things up. When you compare quotes, explain the criteria and trade-offs and end by suggesting they confirm their choice with their broker. If they want to contact the broker, offer to prepare a draft with draftMessageToBroker. Today is ${new Date().toISOString().slice(0, 10)}.
${context.length ? `\nContext:\n${context.join("\n")}` : ""}`;

  const result = streamText({
    model: models.default,
    instructions,
    messages: await convertToModelMessages(messages),
    tools: customerTools(auth),
    stopWhen: isStepCount(5),
    onEnd: async ({ usage }) => {
      await logAiUsage({ feature: "customer_assistant", model: models.default, usage, latencyMs: Date.now() - started, success: true, userId: auth.userId });
    },
    onError: async ({ error }) => {
      log.error("ai.assistant_error", { requestId: ctx.requestId, err: error });
      await logAiUsage({ feature: "customer_assistant", model: models.default, latencyMs: Date.now() - started, success: false, userId: auth.userId });
    },
  });

  return createUIMessageStreamResponse({
    headers: threadId ? { "x-thread-id": threadId } : undefined,
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      messageMetadata: ({ part }) =>
        part.type === "start" ? { threadId, aiAssisted: true, label: AI_LABEL } : part.type === "finish" ? { totalTokens: part.totalUsage.totalTokens } : undefined,
      onEnd: async ({ messages: all }) => {
        if (!threadId) return;
        const { error } = await auth.supabase
          .from("ai_threads")
          .update({ messages: all.slice(-50) as unknown as Json })
          .eq("id", threadId);
        if (error) log.warn("ai.thread_save_failed", { threadId, err: error });
      },
    }),
  });
}
