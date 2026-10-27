"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { AUDIENCE_TAGS, INSTALMENT_PLAN_KEYS, POLICY_PERIODS, parseInstalmentPlan } from "@im/core";
import type { Json } from "@im/db";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

/**
 * Phase 3 product settings on a DRAFT version (insurer underwriters / admins): policy periods,
 * instalment plans (the insurer's grace / lapse / reinstatement rules), the micro flag and audiences.
 * They travel through Covva compliance with the rest of the version; NIC / insurer approval of the
 * short-period or instalment product is the insurer's responsibility (docs/OPERATIONS.md).
 */
const uuid = z.string().uuid();
const num = (lo: number, hi: number) => z.coerce.number().min(lo).max(hi);

export async function setVersionPlans(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const versionId = uuid.safeParse(formData.get("versionId"));
    if (!versionId.success) return { ok: false, error: "Version not found." };
    const { data: v } = await ctx.supabase.from("product_versions").select("id, status, product:products!inner(insurer_org_id)").eq("id", versionId.data).maybeSingle();
    if (!v || (v.product as unknown as { insurer_org_id: string } | null)?.insurer_org_id !== ctx.orgId) return { ok: false, error: "Version not found." };
    if (v.status !== "draft") return { ok: false, error: "Periods and instalment plans change on a draft version (schedule a price change to create one)." };

    const periods = formData.getAll("periods").map(String).filter((p) => (POLICY_PERIODS as readonly string[]).includes(p));
    if (!periods.length) return { ok: false, error: "Choose at least one policy period." };
    const audience = formData.getAll("audience").map(String).filter((t) => (AUDIENCE_TAGS as readonly string[]).includes(t));
    const micro = formData.get("micro") === "on";
    if (micro && !periods.some((p) => p === "day" || p === "week" || p === "month")) return { ok: false, error: "A micro product needs a day, week or month period." };

    const plans: Record<string, unknown>[] = [];
    for (const key of INSTALMENT_PLAN_KEYS) {
      if (formData.get(`${key}_on`) !== "on") continue;
      const f = (n: string) => formData.get(`${key}_${n}`);
      const parsed = z
        .object({ count: num(2, 24), deposit_pct: num(0, 100), surcharge_pct: num(0, 100), grace_days: num(0, 90), lapse_after_days: num(0, 180), within_days: num(0, 365) })
        .safeParse({ count: f("count"), deposit_pct: f("deposit_pct") || 0, surcharge_pct: f("surcharge_pct") || 0, grace_days: f("grace_days") || 0, lapse_after_days: f("lapse_after_days") || 0, within_days: f("within_days") || 0 });
      if (!parsed.success) return { ok: false, error: `${key === "monthly" ? "Monthly" : "Quarterly"} plan: ${parsed.error.issues[0]?.path[0]} ${parsed.error.issues[0]?.message}` };
      if (parsed.data.lapse_after_days < parsed.data.grace_days) return { ok: false, error: "Cover can't lapse before the grace period ends." };
      const plan = parseInstalmentPlan({ key, ...parsed.data, reinstatement: { allowed: f("rein_on") === "on", within_days: parsed.data.within_days, requires_review: f("rein_review") === "on" } });
      if (plan) plans.push(plan as unknown as Record<string, unknown>);
    }
    const { error } = await ctx.supabase.from("product_versions").update({ periods, micro, audience_tags: audience, instalment_plans: plans as unknown as Json }).eq("id", v.id);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Periods and instalment plans saved. They go through compliance review with this version." };
  });
}
