"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { monthRange } from "@/lib/billing";

const Terms = z.object({
  orgId: z.string().uuid({ error: "Choose an organisation" }),
  model: z.enum(["revenue_share", "subscription", "insurer_fee"]),
  revenueSharePct: z.coerce.number().min(0).max(100).default(0),
  platformFeePct: z.coerce.number().min(0).max(100).default(0),
  brokerCommissionPct: z.coerce.number().min(0).max(100).default(0),
  planId: z.string().uuid().optional().or(z.literal("")),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  notes: z.string().trim().max(1000).optional(),
  approve: z.literal("on", { error: "Confirm that the terms were agreed with the partner" }),
});

/**
 * Set an organisation's commercial terms (platform admins). Runs through the
 * SECURITY DEFINER `set_commercial_terms`, which closes the previous open row and
 * records the approver. Ledger postings use the terms in force on the payment date.
 */
export async function setCommercialTerms(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Terms.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const { error } = await auth.supabase.rpc("set_commercial_terms", {
    p_org: d.orgId,
    p_model: d.model,
    p_revenue_share_pct: d.model === "revenue_share" ? d.revenueSharePct : 0,
    p_platform_fee_pct: d.model === "insurer_fee" ? d.platformFeePct : 0,
    p_broker_commission_pct: d.brokerCommissionPct,
    p_subscription_plan_id: d.model === "subscription" && d.planId ? d.planId : undefined,
    p_effective_from: d.effectiveFrom,
    p_notes: d.notes || undefined,
  });
  if (error) return fail(dbMessage(error));
  return done("Commercial terms saved and approved.");
}

const Generate = z.object({
  orgId: z.string().uuid({ error: "Choose an organisation" }),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month"),
});

/** Build or refresh (while draft) the settlement statement for an organisation and month. */
export async function generateStatement(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Generate.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { start, end } = monthRange(parsed.data.period);
  const { error } = await auth.supabase.rpc("build_settlement_statement", { p_org: parsed.data.orgId, p_start: start, p_end: end });
  if (error) return fail(dbMessage(error));
  return done(`Statement for ${parsed.data.period} generated (draft refreshed if it already existed).`);
}

const Transition = z.object({ statementId: z.string().uuid(), to: z.enum(["issued", "paid"]) });

/** draft → issued → paid. Statements are never deleted. */
export async function transitionStatement(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Transition.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.rpc("transition_settlement_statement", { p_id: parsed.data.statementId, p_status: parsed.data.to });
  if (error) return fail(dbMessage(error));
  return done(parsed.data.to === "issued" ? "Statement issued." : "Statement marked paid.");
}
