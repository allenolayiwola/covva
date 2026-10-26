import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { computeMetrics, type PlatformMetrics } from "@/lib/metrics";
import { DEFAULT_MODELS } from "@/lib/ai";

export const maxDuration = 60;

const InsightSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string().describe("Short headline, max 8 words"),
        detail: z.string().describe("One or two sentences: what the numbers show and a suggested operational next step for staff to review"),
        severity: z.enum(["info", "watch", "act"]),
        metric: z.string().optional().describe("The metric(s) this is based on"),
      }),
    )
    .length(5),
});
type Insights = z.infer<typeof InsightSchema>["insights"];

/**
 * POST /ai/insights — summarise aggregate platform metrics into 5 operational
 * insights. Aggregates only (no PII). Records usage in ai_usage (feature
 * `admin_insights`). Falls back to rule-based insights when the AI Gateway is not
 * configured or fails.
 */
export async function POST() {
  const r = await resolveStaff();
  if (r.status !== "ok") return Response.json({ error: "Not authorised" }, { status: r.status === "anonymous" ? 401 : 403 });
  if (!can(r.staff.roles, "insights")) return Response.json({ error: "Your role cannot generate insights" }, { status: 403 });

  const supabase = await createClient();
  const metrics = await computeMetrics(supabase);

  const { data: setting } = await supabase.from("platform_settings").select("value").eq("key", "ai_models").maybeSingle();
  const models = { ...DEFAULT_MODELS, ...((setting?.value as Record<string, string> | null) ?? {}) };
  const { data: flag } = await supabase.from("feature_flags").select("enabled").eq("key", "ai_admin_insights").maybeSingle();
  const model = models.default;

  if (flag && !flag.enabled) {
    return Response.json({ insights: ruleBased(metrics), source: "rules", note: "AI admin insights are switched off (feature flag ai_admin_insights)." });
  }
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json({ insights: ruleBased(metrics), source: "rules", note: "AI Gateway is not configured (AI_GATEWAY_API_KEY missing) — showing rule-based insights." });
  }

  const started = Date.now();
  try {
    const { output, usage, providerMetadata } = await generateText({
      model,
      output: Output.object({ schema: InsightSchema }),
      instructions:
        "You are an operations analyst for a Ghana insurance marketplace technology platform. The platform is a technology provider: it is not an insurer or broker, never holds premiums, and never makes underwriting, suitability or claim decisions. Given aggregate KPIs (JSON), produce exactly 5 concise operational insights for platform staff: highlight risks (SLA breaches, reconciliation exceptions, licence issues, complaints), funnel bottlenecks (quote coverage, response time, conversion, issuance time) and commercial signals (revenue vs premium arranged — premium arranged is NOT platform revenue). Be specific with numbers. British English. Do not invent data that is not in the JSON.",
      prompt: `Platform metrics (aggregates only, last 30 days unless stated):\n${JSON.stringify(metrics)}`,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(45_000),
    });
    await recordUsage(r.staff.userId, model, usage.inputTokens ?? 0, usage.outputTokens ?? 0, gatewayCost(providerMetadata), Date.now() - started, true);
    return Response.json({ insights: output.insights, source: "ai", model, note: "Generated from aggregate metrics only." });
  } catch (e) {
    await recordUsage(r.staff.userId, model, 0, 0, null, Date.now() - started, false);
    const msg = e instanceof Error ? e.message : "AI request failed";
    return Response.json({ insights: ruleBased(metrics), source: "rules", note: `AI request failed (${msg.slice(0, 120)}) — showing rule-based insights.` });
  }
}

function gatewayCost(meta: unknown): number | null {
  const g = (meta as { gateway?: { cost?: unknown } } | undefined)?.gateway;
  const c = g?.cost;
  const n = typeof c === "string" ? Number(c) : typeof c === "number" ? c : NaN;
  return Number.isFinite(n) ? n : null;
}

/** ai_usage has no insert policy for users; recording usage is a system write (service role). */
async function recordUsage(userId: string, model: string, input: number, output: number, cost: number | null, latency: number, success: boolean) {
  try {
    const svc = createServiceClient();
    await svc.from("ai_usage").insert({ user_id: userId, feature: "admin_insights", model, input_tokens: input, output_tokens: output, cost_usd: cost, latency_ms: latency, success });
  } catch {
    // SUPABASE_SECRET_KEY not configured — usage not recorded (reported on the System health page).
  }
}

function ruleBased(m: PlatformMetrics): Insights {
  const pct = (n: number | null) => (n == null ? "n/a" : `${Math.round(n * 100)}%`);
  const list: Insights = [];
  list.push(
    m.sla.breached
      ? { title: "Request SLAs are being missed", detail: `${m.sla.breached} of ${m.sla.openRequests} open requests are past due. Review broker capacity and reassign where a broker is unresponsive.`, severity: "act", metric: "sla.breached" }
      : { title: "Request SLAs on track", detail: `No open requests are past due across ${m.sla.openRequests} open requests.`, severity: "info", metric: "sla.breached" },
  );
  list.push({
    title: m.quotes.pctWith3Plus != null && m.quotes.pctWith3Plus < 0.5 ? "Quote coverage is thin" : "Quote coverage",
    detail: `Average ${m.quotes.avgPerRequest?.toFixed(1) ?? "n/a"} quotes per request; ${pct(m.quotes.pctWith3Plus)} have three or more. Check insurer appointments for under-served categories.`,
    severity: m.quotes.pctWith3Plus != null && m.quotes.pctWith3Plus < 0.5 ? "watch" : "info",
    metric: "quotes.avgPerRequest, quotes.pctWith3Plus",
  });
  list.push({
    title: m.payments.exceptions ? "Payment exceptions need reconciling" : "Payments reconciled",
    detail: m.payments.exceptions
      ? `${m.payments.exceptions} unreconciled exceptions (failed, amount mismatch or no policy 48h after payment). Work the exceptions queue.`
      : "No open reconciliation exceptions.",
    severity: m.payments.exceptions ? "act" : "info",
    metric: "payments.exceptions",
  });
  list.push({
    title: m.complaints.slaBreached ? "Complaints past their deadline" : "Complaints within SLA",
    detail: `${m.complaints.open} open complaints, ${m.complaints.slaBreached} past due and ${m.complaints.escalatedNic} escalated to NIC.`,
    severity: m.complaints.slaBreached ? "act" : m.complaints.open ? "watch" : "info",
    metric: "complaints",
  });
  list.push({
    title: "Revenue vs premium arranged",
    detail: `Platform run-rate is GH₵ ${Math.round(m.revenue.mrr + m.revenue.usageFeesMonth).toLocaleString("en-GB")} a month against GH₵ ${Math.round(m.gwp.activePremium).toLocaleString("en-GB")} of active premium arranged (which settles to insurers, not the platform). ${m.revenue.trialing} subscriptions are still on trial.`,
    severity: m.revenue.trialing ? "watch" : "info",
    metric: "revenue.mrr, gwp.activePremium",
  });
  return list;
}
