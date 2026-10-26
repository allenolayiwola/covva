import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createPublicClient } from "@/lib/supabase/server";
import { notFound, type UserAuth } from "@/server/api-auth";
import { getModels, requireAiFeature } from "./config";
import { AI_LABEL, BASE_INSTRUCTIONS } from "./guardrails";
import { logAiUsage } from "./usage";

const Summary = z.object({
  headline: z.string().describe("One sentence on what this cover is for"),
  covers: z.array(z.string()).describe("Main things that are covered, plain language"),
  notCovered: z.array(z.string()).describe("Items listed as not included"),
  limits: z.array(z.object({ label: z.string(), value: z.string() })),
  excesses: z.array(z.object({ label: z.string(), value: z.string() })),
  keyExclusions: z.array(z.string()).describe("The most important exclusions, key exclusion first"),
  waitingPeriod: z.string().nullable(),
  watchOuts: z.array(z.string()).describe("Things to check with the broker before choosing"),
});

interface CoverInput {
  productName: string | null;
  insurerName: string | null;
  categoryName: string | null;
  status?: string | null;
  premium?: number | null;
  sumInsured?: number | null;
  excess?: number | null;
  coverage: unknown;
  limits: unknown;
  excesses: unknown;
  exclusions: string[];
  keyExclusion: string | null;
  waitingPeriodDays: number;
  optionalBenefits: unknown;
  conditions: string | null;
}

/** Cached per quote / product version: the wording doesn't change once approved. */
async function summarise(cacheKey: string, input: CoverInput, model: string) {
  "use cache";
  cacheLife("days");
  cacheTag("ai-summary", `ai-summary:${cacheKey}`);
  const started = Date.now();
  try {
    const { output, usage } = await generateText({
      model,
      instructions: `${BASE_INSTRUCTIONS}

Task: summarise this insurance quote/product in plain language for a comparison page. Use only the data given. Amounts are GH₵. Do not say whether it is good value or suitable; list what to check with the broker instead.`,
      prompt: JSON.stringify(input),
      output: Output.object({ schema: Summary }),
    });
    await logAiUsage({ feature: "quote_summary", model, usage, latencyMs: Date.now() - started, success: true });
    return { ...output, generatedAt: new Date().toISOString(), model, label: AI_LABEL };
  } catch (err) {
    await logAiUsage({ feature: "quote_summary", model, latencyMs: Date.now() - started, success: false });
    throw err;
  }
}

export async function quoteSummary(auth: UserAuth, args: { quoteId?: string; productVersionId?: string }) {
  await requireAiFeature("ai_assistant");
  const models = await getModels();
  if (args.quoteId) {
    // RLS: the caller must be able to see the quote.
    const { data: q } = await auth.supabase
      .from("quotes")
      .select("id, updated_at, status, premium, sum_insured, excess, coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, insurer:organizations!quotes_insurer_org_id_fkey(name), product:products(name, category:product_categories(name))")
      .eq("id", args.quoteId)
      .maybeSingle();
    if (!q) throw notFound("Quote not found.");
    const product = q.product as unknown as { name: string; category: { name: string } | null } | null;
    const summary = await summarise(`quote:${q.id}:${q.updated_at}`, {
      productName: product?.name ?? null,
      insurerName: (q.insurer as unknown as { name: string } | null)?.name ?? null,
      categoryName: product?.category?.name ?? null,
      status: q.status,
      premium: Number(q.premium),
      sumInsured: q.sum_insured === null ? null : Number(q.sum_insured),
      excess: q.excess === null ? null : Number(q.excess),
      coverage: q.coverage,
      limits: q.limits,
      excesses: q.excesses,
      exclusions: q.exclusions,
      keyExclusion: q.key_exclusion,
      waitingPeriodDays: q.waiting_period_days,
      optionalBenefits: q.optional_benefits,
      conditions: q.conditions,
    }, models.fast);
    return { quoteId: q.id, summary };
  }
  // Approved product versions are public catalogue data.
  const { data: v } = await createPublicClient()
    .from("product_versions")
    .select("id, version, coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, product:products!product_versions_product_id_fkey(name, insurer:organizations!products_insurer_org_id_fkey(name), category:product_categories(name))")
    .eq("id", args.productVersionId!)
    .eq("status", "approved")
    .maybeSingle();
  if (!v) throw notFound("Product not found.");
  const product = v.product as unknown as { name: string; insurer: { name: string } | null; category: { name: string } | null } | null;
  const summary = await summarise(`version:${v.id}`, {
    productName: product?.name ?? null,
    insurerName: product?.insurer?.name ?? null,
    categoryName: product?.category?.name ?? null,
    coverage: v.coverage,
    limits: v.limits,
    excesses: v.excesses,
    exclusions: v.exclusions,
    keyExclusion: v.key_exclusion,
    waitingPeriodDays: v.waiting_period_days,
    optionalBenefits: v.optional_benefits,
    conditions: v.conditions,
  }, models.fast);
  return { productVersionId: v.id, summary };
}
