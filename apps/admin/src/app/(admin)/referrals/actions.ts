"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Toggle = z.object({ key: z.string().regex(/^[a-z0-9_]{3,60}$/), value: z.enum(["true", "false"]) });

/**
 * Switch a reward rule on or off. Customer inducements (referral credits) need the NIC position and
 * every participating insurer's written approval first — the page shows that note next to the toggle.
 */
export async function setRewardRuleActive(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("rewardRules");
  if (!auth.ok) return fail(auth.error);
  const parsed = Toggle.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("reward_rules").update({ active: parsed.data.value === "true" }).eq("key", parsed.data.key);
  if (error) return fail(dbMessage(error));
  return done(parsed.data.value === "true" ? "Rule switched on. Rewards post from the next daily run (04:00)." : "Rule switched off.");
}
