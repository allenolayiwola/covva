import "server-only";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { FAQ_SYSTEM_PROMPT, POLICY_STATUS, formatDate, type WaHandoffReason } from "@im/core";
import { ARTICLES } from "@/components/marketing/articles";
import { FAQ_GROUPS } from "@/components/marketing/content";
import { getModels, requireAiFeature, aiFlagOn } from "@/server/ai/config";
import { AI_LABEL, redactPII } from "@/server/ai/guardrails";
import { logAiUsage } from "@/server/ai/usage";
import { type ApiCtx, parseJson } from "@/server/api-auth";
import { log } from "@/server/log";
import type { Svc, WaContact, WaConversation } from "./sender";

/**
 * The FAQ assistant shared by the WhatsApp bot and the website "Chat with us" drawer.
 *
 * Guardrails (see FAQ_SYSTEM_PROMPT in @im/core): plain English, no advice, no prices,
 * policies are from licensed insurers/brokers, hand off anything advisory. Tools:
 *   - lookup_faq: the marketing FAQ + Learn articles (no account data),
 *   - find_policy_summary (WhatsApp, linked customers only): status + renewal date,
 *   - handoff (WhatsApp): signals that a person should take over; the router performs it.
 */

// ---------------------------------------------------------------------------
// FAQ search (token overlap over the FAQ groups and Learn articles)
// ---------------------------------------------------------------------------
interface FaqDoc { id: string; question: string; answer: string; source: "faq" | "learn"; tokens: Set<string> }

const STOP = new Set(["the", "a", "an", "is", "are", "do", "does", "i", "my", "me", "to", "of", "for", "in", "on", "it", "and", "or", "what", "how", "can", "you", "your", "with", "be", "if", "we", "at", "this", "that", "about", "from", "by", "have", "has"]);
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
      .map((t) => t.replace(/(ies|s|ing|ed)$/, "")),
  );
}

let DOCS: FaqDoc[] | null = null;
function docs(): FaqDoc[] {
  if (DOCS) return DOCS;
  const out: FaqDoc[] = [];
  for (const g of FAQ_GROUPS) for (const it of g.items) out.push({ id: `faq:${it.id}`, question: it.q, answer: it.a, source: "faq", tokens: tokens(`${g.title} ${it.q} ${it.a}`) });
  for (const a of ARTICLES) {
    const body = a.body
      .map((b) => (b.type === "ul" || b.type === "ol" ? b.items.join(" ") : b.text))
      .join(" ")
      .slice(0, 1500);
    out.push({ id: `learn:${a.slug}`, question: a.title, answer: `${a.summary} ${body}`.slice(0, 1600), source: "learn", tokens: tokens(`${a.topic} ${a.title} ${a.summary} ${body}`) });
  }
  DOCS = out;
  return out;
}

export function searchFaq(query: string, limit = 4): { id: string; question: string; answer: string; source: "faq" | "learn"; url: string | null }[] {
  const q = tokens(query);
  if (!q.size) return [];
  return docs()
    .map((d) => {
      let hits = 0;
      for (const t of q) if (d.tokens.has(t)) hits++;
      const questionBoost = [...q].filter((t) => tokens(d.question).has(t)).length;
      return { d, score: hits + questionBoost * 1.5 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({ id: d.id, question: d.question, answer: d.answer, source: d.source, url: d.source === "learn" ? `/learn/${d.id.slice(6)}` : `/support#${d.id.slice(4)}` }));
}

function faqTool() {
  return tool({
    description: "Search Covva's help centre FAQ and Learn articles for how the platform works (quotes, brokers, insurers, payments, claims, renewals, documents, diaspora, data protection). Returns the best matching answers; quote them faithfully.",
    inputSchema: z.object({ query: z.string().min(2).max(200) }),
    execute: async ({ query }) => {
      const results = searchFaq(query);
      return results.length ? { results } : { results: [], note: "Nothing in the FAQ matches. Say so and offer a human or the broker." };
    },
  });
}

// ---------------------------------------------------------------------------
// WhatsApp bot turn (non-streaming)
// ---------------------------------------------------------------------------
export interface BotTurnInput {
  contact: WaContact;
  conversation: WaConversation;
  /** Prior turns, oldest first (already redacted). */
  history: { role: "user" | "assistant"; text: string }[];
  userText: string;
  /** Extra context lines (links, known-customer facts) for the model. */
  context?: string[];
}

export interface BotTurnResult {
  reply: string;
  handoff: { reason: WaHandoffReason; note: string } | null;
  usedModel: boolean;
}

const FALLBACK_REPLY =
  "Thanks for your message. I can answer questions about how Covva works, quotes, claims, renewals and documents. Type \"human\" to reach our support team or \"broker\" to reach your broker. Policies on Covva are arranged by licensed brokers and issued by licensed insurers; we don't give advice or quote prices here.";

/**
 * One bot reply for a WhatsApp message. Falls back to a safe canned reply when AI is off
 * or unavailable. Usage is logged to `ai_usage` (feature `whatsapp_faq`).
 */
export async function answerWhatsApp(svc: Svc, input: BotTurnInput): Promise<BotTurnResult> {
  if (!(await aiFlagOn("ai_assistant"))) return { reply: FALLBACK_REPLY, handoff: null, usedModel: false };
  const models = await getModels();
  const started = Date.now();
  let handoff: BotTurnResult["handoff"] = null;
  const linked = !!input.contact.user_id;

  const tools = {
    lookup_faq: faqTool(),
    ...(linked
      ? {
          find_policy_summary: tool({
            description: "For this known customer only: list their policies with status and renewal (cover end) date. No amounts, no documents.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await svc
                .from("policies")
                .select("internal_reference, policy_number, status, cover_end, category:product_categories(name), insurer:organizations!policies_insurer_org_id_fkey(name)")
                .eq("customer_id", input.contact.user_id!)
                .order("cover_end", { ascending: false, nullsFirst: false })
                .limit(10);
              return (data ?? []).map((p) => ({
                reference: p.policy_number ?? p.internal_reference,
                category: (p.category as unknown as { name: string } | null)?.name ?? null,
                insurer: (p.insurer as unknown as { name: string } | null)?.name ?? null,
                status: POLICY_STATUS[p.status].label,
                hint: POLICY_STATUS[p.status].customerHint ?? null,
                renewalDate: p.cover_end ? formatDate(p.cover_end) : null,
              }));
            },
          }),
        }
      : {}),
    handoff: tool({
      description: "Hand this conversation to a person. Use reason 'advice' when the person needs a recommendation or suitability judgement (the licensed broker takes over), 'claim' for help with a claim, 'complaint' for a complaint, 'payment_issue' for a payment problem, 'requested' when they ask for a human, 'unknown' when you cannot help. Give a one-line summary in note.",
      inputSchema: z.object({ reason: z.enum(["advice", "complaint", "payment_issue", "claim", "unknown", "requested"]), note: z.string().min(3).max(300) }),
      execute: async ({ reason, note }) => {
        handoff = { reason, note: redactPII(note) };
        return { ok: true, next: reason === "advice" || reason === "claim" ? "Tell the person a licensed broker will take over this chat." : "Tell the person a member of the support team will take over this chat." };
      },
    }),
  };

  const messages: ModelMessage[] = [
    ...input.history.slice(-10).map((h) => ({ role: h.role, content: h.text }) as ModelMessage),
    { role: "user", content: redactPII(input.userText).slice(0, 2000) },
  ];
  const instructions = `${FAQ_SYSTEM_PROMPT}

Channel: WhatsApp. Keep every reply under 600 characters, no markdown. Today is ${new Date().toISOString().slice(0, 10)}.
${linked ? "The person is a known Covva customer (their number matches an account). Do not reveal personal details; you may use find_policy_summary for status and renewal dates only." : "The person is not linked to a Covva account; do not look anything up about them."}
${input.context?.length ? `\nContext:\n${input.context.join("\n")}` : ""}`;

  try {
    const { text, usage } = await generateText({ model: models.fast, instructions, messages, tools, stopWhen: isStepCount(4) });
    await logAiUsage({ feature: "whatsapp_faq", model: models.fast, usage, latencyMs: Date.now() - started, success: true, userId: input.contact.user_id });
    const reply = text.trim() || (handoff ? "A member of our team will take over this chat shortly." : FALLBACK_REPLY);
    return { reply: reply.slice(0, 1200), handoff, usedModel: true };
  } catch (err) {
    log.error("whatsapp.assistant_error", { conversationId: input.conversation.id, err });
    await logAiUsage({ feature: "whatsapp_faq", model: models.fast, latencyMs: Date.now() - started, success: false, userId: input.contact.user_id });
    return { reply: FALLBACK_REPLY, handoff: null, usedModel: false };
  }
}

// ---------------------------------------------------------------------------
// Website "Chat with us" drawer (anonymous, streaming, FAQ only)
// ---------------------------------------------------------------------------
const FaqRequest = z.object({ messages: z.array(z.unknown()).min(1).max(40) });

function sanitise(raw: unknown[]): UIMessage[] {
  return (raw as UIMessage[])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-16)
    .map((m, i) => ({
      ...m,
      id: m.id || `m${i}`,
      parts: (m.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? { ...p, text: (m.role === "user" ? redactPII(p.text) : p.text).slice(0, 1500) } : p)),
    }));
}

/**
 * POST /api/ai/faq — anonymous FAQ chat for the marketing site. No account data, no
 * tools other than the FAQ. Rate-limited by the route; usage logged as `web_faq`.
 */
export async function faqStreamHandler(ctx: ApiCtx<"none">): Promise<Response> {
  const body = await parseJson(ctx.req, FaqRequest);
  await requireAiFeature("ai_assistant");
  const models = await getModels();
  const messages = sanitise(body.messages);
  const started = Date.now();
  const instructions = `${FAQ_SYSTEM_PROMPT}

Channel: the website chat drawer. You have no access to any account; if someone asks about their own policy, claim or payment, tell them to sign in to Covva or use the "Talk to a human / my broker" button. Today is ${new Date().toISOString().slice(0, 10)}.`;

  const result = streamText({
    model: models.fast,
    instructions,
    messages: await convertToModelMessages(messages),
    tools: { lookup_faq: faqTool() },
    stopWhen: isStepCount(3),
    onEnd: async ({ usage }) => {
      await logAiUsage({ feature: "web_faq", model: models.fast, usage, latencyMs: Date.now() - started, success: true });
    },
    onError: async ({ error }) => {
      log.error("ai.faq_error", { requestId: ctx.requestId, err: error });
      await logAiUsage({ feature: "web_faq", model: models.fast, latencyMs: Date.now() - started, success: false });
    },
  });
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      messageMetadata: ({ part }) => (part.type === "start" ? { aiAssisted: true, label: AI_LABEL } : undefined),
    }),
  });
}
