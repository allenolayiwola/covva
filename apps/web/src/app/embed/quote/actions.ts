"use server";
import { z } from "zod";
import { getEmbedPartner, indicativeEstimates, type IndicativeResult } from "@/server/referrals";

const Input = z.object({ partner: z.string().max(20), category: z.string().min(1).max(60), risk: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) });

export type EstimateState = { ok: true; result: IndicativeResult } | { ok: false; error: string } | null;

/** Widget estimate (public: the widget has no sign-in). Re-checks the partner code on every call; nothing is stored. */
export async function estimateAction(input: unknown): Promise<EstimateState> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some of the details are not valid." };
  const partner = await getEmbedPartner(parsed.data.partner);
  if (!partner) return { ok: false, error: "This quote widget is not available right now." };
  const risk = Object.fromEntries(Object.entries(parsed.data.risk).filter(([, v]) => v !== ""));
  const result = await indicativeEstimates(parsed.data.category, risk, partner.allowedCategories);
  if (!result) return { ok: false, error: "This type of cover isn't available through this widget." };
  return { ok: true, result };
}
