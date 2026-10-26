import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { REQUEST_STATUS } from "@im/core";
import { forbidden, notFound, type UserAuth } from "@/server/api-auth";
import { getModels, requireAiFeature } from "./config";
import { AI_DRAFT_LABEL, BASE_INSTRUCTIONS, redactPII, stripPII } from "./guardrails";
import { logAiUsage } from "./usage";

const Copilot = z.object({
  riskSummary: z.string().describe("Short summary of the risk from the risk data"),
  conversationSummary: z.string().describe("What has been discussed so far and what the customer is waiting for"),
  suggestedNextActions: z.array(z.string()).describe("Concrete next actions for the adviser, most urgent first"),
  missingInformation: z.array(z.string()).describe("Information or documents still needed before insurers can quote or issue"),
  customerMessageDraft: z.string().describe("A short, warm message the adviser could send the customer. Sign off as the adviser; no promises of cover or approval."),
});

/**
 * Broker co-pilot: summarise a routed request and draft a customer message.
 * The adviser must review and send it — output is labelled as an AI draft.
 */
export async function brokerCopilot(auth: UserAuth, requestId: string) {
  await requireAiFeature("ai_assistant");
  const { data: r } = await auth.supabase
    .from("requests")
    .select("id, reference, status, type, title, risk_data, needs_adviser_review, due_at, next_step, broker_org_id, created_at, category:product_categories(name, slug, required_documents)")
    .eq("id", requestId)
    .maybeSingle();
  if (!r) throw notFound("Request not found.");
  // Partner session: the caller must be an active member of the broker of record (or platform staff).
  const { data: memberships } = await auth.supabase
    .from("memberships")
    .select("org_id, org:organizations!memberships_org_id_fkey(type)")
    .eq("user_id", auth.userId)
    .eq("active", true);
  const isBroker = (memberships ?? []).some((m) => m.org_id === r.broker_org_id);
  const isStaff = (memberships ?? []).some((m) => (m.org as unknown as { type: string } | null)?.type === "platform");
  if (!r.broker_org_id || (!isBroker && !isStaff)) throw forbidden("Only the broker of record can use the co-pilot on this request.");

  const [{ data: messages }, { data: tasks }, { data: docs }, { data: quotes }] = await Promise.all([
    auth.supabase.from("request_messages").select("sender_party, body, internal, created_at").eq("request_id", r.id).order("created_at").limit(40),
    auth.supabase.from("request_tasks").select("title, kind, status, assignee_party, document_kind").eq("request_id", r.id),
    auth.supabase.from("documents").select("kind, created_at, verified").eq("request_id", r.id),
    auth.supabase.from("quotes").select("status, premium, valid_until, insurer:organizations!quotes_insurer_org_id_fkey(name)").eq("request_id", r.id),
  ]);

  const category = r.category as unknown as { name: string; slug: string; required_documents: string[] } | null;
  const models = await getModels();
  const started = Date.now();
  try {
    const { output, usage } = await generateText({
      model: models.default,
      instructions: `${BASE_INSTRUCTIONS}

You are assisting a licensed broker's adviser (not the customer). Summarise the request, suggest next actions and missing information, and draft a customer message for the adviser to review. The adviser makes all advice decisions; you never decide suitability or cover. Customer identity details have been removed — address the customer neutrally ("Hello,").`,
      prompt: JSON.stringify({
        reference: r.reference,
        category: category?.name,
        type: r.type,
        status: REQUEST_STATUS[r.status].label,
        dueAt: r.due_at,
        needsAdviserReview: r.needs_adviser_review,
        risk: stripPII(r.risk_data as Record<string, unknown>),
        requiredDocuments: category?.required_documents ?? [],
        documentsUploaded: (docs ?? []).map((d) => ({ kind: d.kind, verified: d.verified })),
        tasks: tasks ?? [],
        quotes: (quotes ?? []).map((q) => ({ insurer: (q.insurer as unknown as { name: string } | null)?.name, status: q.status, premium: q.premium, validUntil: q.valid_until })),
        conversation: (messages ?? []).map((m) => ({ from: m.sender_party, internalNote: m.internal, at: m.created_at, text: redactPII(m.body).slice(0, 800) })),
      }),
      output: Output.object({ schema: Copilot }),
    });
    await logAiUsage({ feature: "broker_copilot", model: models.default, usage, latencyMs: Date.now() - started, success: true, userId: auth.userId, orgId: r.broker_org_id });
    return { requestId: r.id, ...output, label: AI_DRAFT_LABEL, generatedAt: new Date().toISOString(), model: models.default };
  } catch (err) {
    await logAiUsage({ feature: "broker_copilot", model: models.default, latencyMs: Date.now() - started, success: false, userId: auth.userId, orgId: r.broker_org_id });
    throw err;
  }
}
