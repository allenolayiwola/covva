import { PolicyExplainInput } from "@im/core";
import { RATE_LIMITS, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { explainQuestion, explainerClauses, explainerSummary, handoffToBroker, loadExplainerContext } from "@/server/ai/policy-explainer";

export const maxDuration = 60;

/**
 * POST /api/v1/me/policies/{id}/explain — policy explainer for the signed-in policyholder
 * (customer, sponsor or linked beneficiary).
 *   { action: "clauses" }                         grounding set for the clause browser
 *   { action: "summary" }                         "Your cover in plain words" (cached per wording version)
 *   { action: "ask", question }                   cited answer (or keyword matches without AI)
 *   { action: "handoff", question, clauseIds, logId? }  message to the broker of record
 * AI rate limit applies to every action. Without the AI Gateway the answers fall back to clauses.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/me/policies/[id]/explain">) => {
    const id = uuidParam((await route.params).id, "policy");
    const input = await parseJson(req, PolicyExplainInput);
    const ctx = await loadExplainerContext(auth.supabase, auth.userId, id);
    switch (input.action) {
      case "clauses":
        return explainerClauses(ctx);
      case "summary":
        return { policyId: ctx.policyId, versionKey: ctx.grounding.versionKey, summary: await explainerSummary(auth.supabase, auth.userId, ctx) };
      case "ask":
        return explainQuestion(auth.userId, ctx, input.question);
      case "handoff":
        return Response.json({ ok: true, data: await handoffToBroker(auth.supabase, auth.userId, ctx, input) }, { status: 201 });
    }
  },
  { auth: "user", rateLimit: RATE_LIMITS.ai },
);
