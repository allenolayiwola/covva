"use server";
import { z } from "zod";
import { partnerBillingEnabled } from "@/lib/partner-billing";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const date = z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date");

const Save = z.object({
  subscriptionId: z.union([z.string().uuid(), z.literal("")]).optional(),
  orgId: z.string().uuid(),
  planId: z.string().uuid({ error: "Choose a plan" }),
  status: z.enum(["trialing", "active", "past_due", "cancelled"]),
  trial_ends_on: date,
  current_period_start: z.iso.date(),
  current_period_end: z.iso.date(),
  cancel_at_period_end: z.string().optional(),
});

/** Create or update the organisation's live subscription (one live subscription per org). */
export async function saveSubscription(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  if (!await partnerBillingEnabled(auth.supabase)) return fail("Partner platform-fee billing is disabled.");
  const parsed = Save.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const { supabase } = auth;

  const [{ data: org }, { data: plan }] = await Promise.all([
    supabase.from("organizations").select("type").eq("id", d.orgId).single(),
    supabase.from("plans").select("audience, active, name").eq("id", d.planId).single(),
  ]);
  if (d.current_period_end < d.current_period_start) return fail("Renewal date must be on or after the start date.");
  if (!org || !plan) return fail("Organisation or plan not found.");
  if (plan.audience !== org.type) return fail(`“${plan.name}” is a ${plan.audience} plan; this organisation is a ${org.type}.`);
  if (d.status === "trialing" && !d.trial_ends_on) return fail("Set a trial end date for trialing subscriptions.");

  if (org.type === "platform") return fail("Choose a partner organisation.");
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
  const id = d.subscriptionId || live?.id;
  if (!plan.active) {
    const { data: current } = id ? await supabase.from("subscriptions").select("plan_id").eq("id", id).eq("org_id", d.orgId).maybeSingle() : { data: null };
    if (current?.plan_id !== d.planId) return fail("Choose an active plan.");
  }
  const { data: saved, error } = id
    ? await supabase.from("subscriptions").update(values).eq("id", id).eq("org_id", d.orgId).select("id").maybeSingle()
    : await supabase.from("subscriptions").insert({ org_id: d.orgId, ...values }).select("id").single();
  if (error) return fail(dbMessage(error));
  if (!saved) return fail("Subscription not found or no longer editable.");
  return done(id ? "Subscription updated." : "Subscription created.");
}
