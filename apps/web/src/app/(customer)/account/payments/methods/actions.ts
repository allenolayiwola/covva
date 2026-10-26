"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError } from "@/server/requests";
import { revokePaymentMethod, setDefaultPaymentMethod } from "@/server/payment-methods";
import type { ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext } from "../../_lib/action";

const uuid = z.string().uuid();

async function run(id: string, fn: (userId: string) => Promise<string>): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown payment method." };
  try {
    const message = await fn(user.id);
    revalidatePath("/account/payments", "layout");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    console.error("payment method action failed", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function makeDefaultMethod(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return run(id, async (userId) => {
    await setDefaultPaymentMethod(userId, id);
    return "Default card updated.";
  });
}

export async function removeMethod(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return run(id, async (userId) => {
    const r = await revokePaymentMethod(userId, id);
    return r.affectedSubscriptions ? `Card removed. ${r.affectedSubscriptions} recurring payment${r.affectedSubscriptions === 1 ? " needs" : "s need"} a new card.` : "Card removed.";
  });
}
