"use server";
import { z } from "zod";
import { revalidateEverywhere } from "@/lib/revalidate";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Moderate = z.object({ reviewId: z.string().uuid(), status: z.enum(["published", "hidden"]), reason: z.string().trim().max(1000).optional() });

/** Hide (or re-publish) a customer review. The partner's rating is recomputed by the database. Reviews are never deleted. */
export async function moderateReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Moderate.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("service_partner_reviews").update({ status: parsed.data.status, hidden_reason: parsed.data.status === "hidden" ? parsed.data.reason ?? null : null }).eq("id", parsed.data.reviewId);
  if (error) return fail(dbMessage(error));
  await revalidateEverywhere(["service-partners"]);
  return done(parsed.data.status === "hidden" ? "Review hidden. The partner's rating has been recalculated." : "Review published again.");
}
