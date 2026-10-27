"use server";
import { refresh } from "next/cache";
import { DEFAULT_STACKING_ORDER, loyaltyRulesFromForm, validateLoyaltyRuleSet } from "@im/core";
import type { Json } from "@im/db";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

/**
 * Insurer owners/admins publish a NEW VERSION of their reward rules. The same validation runs here (friendly
 * messages) and in the database (private.validate_loyalty_rules); the RPC supersedes the previous version and
 * the audit log records who published what. Quotes priced from now on use the new version; existing discount
 * lines keep the version they were evaluated with.
 */
export async function publishRewardRules(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.orgAdmin });
    const parsed = loyaltyRulesFromForm(Object.fromEntries(formData));
    const errors = validateLoyaltyRuleSet({ maxCombinedPct: parsed.maxCombinedPct, stackingOrder: [...DEFAULT_STACKING_ORDER], rules: parsed.rules });
    if (errors.length) return { ok: false, error: errors.join(" ") };
    const { data, error } = await ctx.supabase.rpc("publish_loyalty_rule_set", {
      p_insurer_org_id: ctx.orgId,
      p_rules: parsed.rules as unknown as Json,
      p_max_combined_pct: parsed.maxCombinedPct,
      p_effective_from: parsed.effectiveFrom ?? undefined,
      p_effective_to: parsed.effectiveTo ?? undefined,
      p_note: parsed.note ?? undefined,
    });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't publish the rules.") };
    refresh();
    const active = parsed.rules.filter((r) => r.active).length;
    return { ok: true, message: `Version ${data?.version ?? "?"} published with ${active} active rule${active === 1 ? "" : "s"}. New quotes and renewals use it from now.` };
  });
}
