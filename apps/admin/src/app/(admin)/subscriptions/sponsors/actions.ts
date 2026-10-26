"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Input = z.object({ subscriptionId: z.string().uuid(), op: z.enum(["retry", "pause", "cancel"]), reason: z.string().trim().max(500).optional() });

/**
 * Sponsor subscription operations (platform ops). Writes go through staff RLS on
 * `sponsor_subscriptions` and are audited by trigger. "Retry" clears the failure count and
 * brings the next collection forward so the web app's `sponsor-collections` cron charges it
 * on its next run (ops never move money themselves).
 */
export async function sponsorSubscriptionOp(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Input.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { subscriptionId, op, reason } = parsed.data;
  const now = new Date().toISOString();
  const patch =
    op === "retry"
      ? { status: "active", failures: 0, next_charge_at: now, past_due_since: null }
      : op === "pause"
        ? { status: "paused", paused_at: now }
        : { status: "cancelled", cancelled_at: now, metadata: { cancel_reason: reason ?? `Cancelled by platform staff ${auth.staff.userId}` } };
  const { data, error } = await auth.supabase.from("sponsor_subscriptions").update(patch).eq("id", subscriptionId).neq("status", "cancelled").select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("Subscription not found or already cancelled.");
  return done(op === "retry" ? "Retry scheduled for the next collections run (daily 03:00)." : op === "pause" ? "Subscription paused." : "Subscription cancelled.");
}
