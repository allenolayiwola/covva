"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError } from "@/server/requests";
import { cancelSubscription, pauseSubscription, resumeSubscription } from "@/server/subscriptions";
import type { ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext } from "../../_lib/action";

const uuid = z.string().uuid();

async function run(subscriptionId: string, fn: (userId: string) => Promise<string>): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(subscriptionId).success) return { ok: false, error: "Unknown subscription." };
  try {
    const message = await fn(user.id);
    revalidatePath("/account/payments/subscriptions");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    console.error("subscription action failed", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function pauseSponsorSubscription(subscriptionId: string): Promise<ActionState> {
  return run(subscriptionId, async (userId) => {
    await pauseSubscription(subscriptionId, userId);
    return "Collections paused. Resume before the next premium is due to keep cover in force.";
  });
}

export async function resumeSponsorSubscription(subscriptionId: string): Promise<ActionState> {
  return run(subscriptionId, async (userId) => {
    await resumeSubscription(subscriptionId, userId);
    return "Collections resumed.";
  });
}

export async function cancelSponsorSubscription(subscriptionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null;
  return run(subscriptionId, async (userId) => {
    await cancelSubscription(subscriptionId, userId, reason);
    return "Subscription cancelled. Existing cover runs to its end date.";
  });
}
