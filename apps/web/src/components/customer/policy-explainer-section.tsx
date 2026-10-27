import { groupClauses } from "@im/core";
import type { UserClient } from "@/server/api-auth";
import { cachedSummary, explainerAvailability, explainerSummary, handoffInfo, loadExplainerContext } from "@/server/ai/policy-explainer";
import { log } from "@/server/log";
import { PolicyExplainer, type ExplainerSummaryView } from "./policy-explainer";

/**
 * Server half of the "Explain my policy" panel: loads the grounding set with the viewer's RLS client,
 * the cached plain-words summary (or the schedule-based one when AI is off) and the hand-off thread.
 * Renders nothing for viewers who aren't on the policyholder side.
 */
export async function PolicyExplainerSection({ supabase, userId, policyId, isDemo }: { supabase: UserClient; userId: string; policyId: string; isDemo: boolean }) {
  let ctx: Awaited<ReturnType<typeof loadExplainerContext>>;
  try {
    ctx = await loadExplainerContext(supabase, userId, policyId);
  } catch (err) {
    if (!(err instanceof Error && /not found/i.test(err.message))) log.warn("explainer.section_failed", { policyId, err });
    return null;
  }
  if (!ctx.grounding.clauses.length) return null;
  const { aiAvailable } = await explainerAvailability();
  // With AI: show the cached summary if there is one (the panel generates it once otherwise).
  // Without AI: the schedule-based summary, computed here (no model call).
  const summary = aiAvailable ? await cachedSummary(supabase, ctx) : await explainerSummary(supabase, userId, ctx);
  const groups = groupClauses(ctx.grounding).map((g) => ({ group: g.group, clauses: g.clauses.map((c) => ({ id: c.id, heading: c.heading, group: c.group, text: c.text })) }));
  return (
    <PolicyExplainer
      policyId={ctx.policyId}
      policyRef={ctx.grounding.policyRef}
      groups={groups}
      initialSummary={summary as ExplainerSummaryView | null}
      aiAvailable={aiAvailable}
      handoff={handoffInfo(ctx)}
      isDemo={isDemo}
      wordingUrl={ctx.wordingUrl}
    />
  );
}
