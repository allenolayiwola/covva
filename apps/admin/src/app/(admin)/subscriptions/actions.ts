"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const date = z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date");

const Save = z.object({
  orgId: z.string().uuid(),
  planId: z.string().uuid({ error: "Choose a plan" }),
  status: z.enum(["trialing", "active", "past_due", "cancelled"]),
  trial_ends_on: date,
  current_period_start: date,
  current_period_end: date,
  cancel_at_period_end: z.string().optional(),
});

/** Create or update the organisation's live subscription (one live subscription per org). */
export async function saveSubscription(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Save.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const { supabase } = auth;

  const [{ data: org }, { data: plan }] = await Promise.all([
    supabase.from("organizations").select("type").eq("id", d.orgId).single(),
    supabase.from("plans").select("audience, active, name").eq("id", d.planId).single(),
  ]);
  if (!org || !plan) return fail("Organisation or plan not found.");
  if (plan.audience !== org.type) return fail(`“${plan.name}” is a ${plan.audience} plan; this organisation is a ${org.type}.`);
  if (d.status === "trialing" && !d.trial_ends_on) return fail("Set a trial end date for trialing subscriptions.");

  const { data: live } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("org_id", d.orgId)
    .in("status", ["trialing", "active", "past_due"])
    .maybeSingle();

  const values = {
    plan_id: d.planId,
    status: d.status,
    trial_ends_on: d.trial_ends_on,
    cancel_at_period_end: d.cancel_at_period_end === "on",
    ...(d.current_period_start ? { current_period_start: d.current_period_start } : {}),
    ...(d.current_period_end ? { current_period_end: d.current_period_end } : {}),
  };
  const { error } = live
    ? await supabase.from("subscriptions").update(values).eq("id", live.id)
    : await supabase.from("subscriptions").insert({ org_id: d.orgId, ...values });
  if (error) return fail(dbMessage(error));
  return done(live ? "Subscription updated." : "Subscription created.");
}
