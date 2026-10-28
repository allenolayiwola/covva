"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError } from "@/server/requests";
import { revealGift } from "@/server/diaspora";
import { actionContext } from "../../_lib/action";

/** The linked beneficiary opens the gift: records `gift_revealed_at` and returns the sponsor's message. */
export async function openGift(sponsorshipId: string): Promise<{ ok: true; message: string | null } | { ok: false; error: string }> {
  const { supabase, user } = await actionContext();
  if (!user) return { ok: false, error: "Your session has ended. Please sign in again." };
  if (!z.string().uuid().safeParse(sponsorshipId).success) return { ok: false, error: "Unknown gift." };
  try {
    const r = await revealGift(supabase, sponsorshipId);
    revalidatePath(`/account/gifts/${sponsorshipId}`);
    return { ok: true, message: r.giftMessage };
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't open that gift." };
  }
}
