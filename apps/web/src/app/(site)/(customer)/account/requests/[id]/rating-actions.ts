"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/customer/utils";
import { rateBroker } from "@/server/scorecards";
import { BusinessRuleError } from "@/server/requests";
import { SIGNED_OUT, actionContext } from "../../_lib/action";

const uuid = z.string().uuid();
const Input = z.object({ rating: z.coerce.number().int().min(1, "Choose 1 to 5 stars.").max(5, "Choose 1 to 5 stars."), comment: z.string().trim().max(600, "Keep it under 600 characters.").optional() });

/** The customer rates the broker of record on their completed request (one rating per request). */
export async function rateBrokerForRequest(requestId: string, brokerOrgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(brokerOrgId).success) return { ok: false, error: "Unknown request." };
  const parsed = Input.safeParse({ rating: formData.get("rating"), comment: formData.get("comment") || undefined });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose 1 to 5 stars." };
  try {
    await rateBroker(supabase, { userId: user.id, subjectType: "request", subjectId: requestId, brokerOrgId, rating: parsed.data.rating, comment: parsed.data.comment });
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't save your rating." };
  }
  revalidatePath(`/account/requests/${requestId}`);
  revalidateTag("scorecards", "max");
  return { ok: true, message: "Thank you. Your rating helps other customers choose a broker and helps brokers improve." };
}
