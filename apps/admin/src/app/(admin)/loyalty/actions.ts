"use server";
import { DEFAULT_STACKING_ORDER, loyaltyRulesFromForm, validateLoyaltyRuleSet } from "@im/core";
import type { Json } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, type ActionState } from "@/lib/actions";

/**
 * Publish a new version of the PLATFORM FALLBACK rule set (insurer_org_id null): used only by insurers who have
 * not published their own rules. Discounts are funded by the insurer, so the defaults need insurer sign-off
 * before any rule is switched on. Platform admin or compliance; every version is audited.
 */
export async function publishFallbackRules(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("loyalty");
  if (!auth.ok) return fail(auth.error);
  const parsed = loyaltyRulesFromForm(formObject(fd));
  const errors = validateLoyaltyRuleSet({ maxCombinedPct: parsed.maxCombinedPct, stackingOrder: [...DEFAULT_STACKING_ORDER], rules: parsed.rules });
  if (errors.length) return fail(errors.join(" "));
  const { data, error } = await auth.supabase.rpc("publish_loyalty_rule_set", {
    p_insurer_org_id: undefined,
    p_rules: parsed.rules as unknown as Json,
    p_max_combined_pct: parsed.maxCombinedPct,
    p_effective_from: parsed.effectiveFrom ?? undefined,
    p_effective_to: parsed.effectiveTo ?? undefined,
    p_note: parsed.note ?? undefined,
  });
  if (error) return fail(dbMessage(error));
  return done(`Platform fallback version ${data?.version ?? "?"} published. Insurers with their own rules are unaffected.`);
}
