import "server-only";
import type { LanguageModelUsage } from "ai";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

/**
 * Log every model call to `ai_usage` and, when an organisation is billable for it,
 * a `usage_events` row (metric `ai_tokens`). Service client: `ai_usage` has no insert
 * policy — it is written only by trusted server code.
 */
export async function logAiUsage(e: {
  feature: string;
  model: string;
  usage?: LanguageModelUsage | null;
  latencyMs: number;
  success: boolean;
  userId?: string | null;
  orgId?: string | null;
}) {
  try {
    const svc = createServiceClient();
    const input = e.usage?.inputTokens ?? 0;
    const output = e.usage?.outputTokens ?? 0;
    await svc.from("ai_usage").insert({
      user_id: e.userId ?? null,
      org_id: e.orgId ?? null,
      feature: e.feature,
      model: e.model,
      input_tokens: input,
      output_tokens: output,
      latency_ms: Math.round(e.latencyMs),
      success: e.success,
    });
    const total = e.usage?.totalTokens ?? input + output;
    if (e.orgId && total > 0) {
      await svc.from("usage_events").insert({ org_id: e.orgId, metric: "ai_tokens", quantity: total });
    }
  } catch (err) {
    log.warn("ai.usage_log_failed", { feature: e.feature, err });
  }
  log.info("ai.call", { feature: e.feature, model: e.model, ms: Math.round(e.latencyMs), success: e.success, tokens: e.usage?.totalTokens ?? null });
}
