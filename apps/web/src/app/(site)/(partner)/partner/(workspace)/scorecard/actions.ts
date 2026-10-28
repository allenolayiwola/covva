"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/partner/action-form";
import { replyToReview } from "@/server/scorecards";
import { BusinessRuleError } from "@/server/requests";
import { ActionError, actionContext, run } from "../../_lib/context";

const Reply = z.object({ reviewId: z.string().uuid(), reply: z.string().trim().min(1, "Write a reply first.").max(600, "Keep your reply under 600 characters.") });

/** One public reply per approved review, by the broker's team (owner, admin, supervisor, adviser). */
export async function replyToBrokerReview(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ["owner", "admin", "supervisor", "adviser"] });
    const parsed = Reply.safeParse({ reviewId: formData.get("reviewId"), reply: formData.get("reply") });
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Check your reply.");
    try {
      await replyToReview(ctx.supabase, parsed.data.reviewId, parsed.data.reply);
    } catch (err) {
      throw new ActionError(err instanceof BusinessRuleError ? err.message : "We couldn't save your reply.");
    }
    revalidatePath("/partner/scorecard");
    revalidateTag("scorecards", "max");
    return { ok: true, message: "Reply published. It appears under the review with your organisation's name." };
  });
}
