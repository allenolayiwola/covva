import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/catalog";

/**
 * Indicative "from" prices per catalogue category, read from the `min_premium` of approved
 * product versions' rating rules (annual, GHS). Marketing pages show `from GHS X/month`
 * (annual ÷ 12, rounded) and fall back to content when no approved product exists.
 */
export async function getFromPrices(): Promise<Record<string, number>> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog", "from-prices");
  const [categories, { data }] = await Promise.all([
    getCategories(),
    createPublicClient().from("products").select("category_id, version:product_versions!products_current_version_fk(rating)").eq("status", "approved"),
  ]);
  const slugById = new Map(categories.map((c) => [c.id, c.slug]));
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as unknown as { category_id: string; version: { rating: unknown } | null }[]) {
    const slug = slugById.get(row.category_id);
    const rating = row.version?.rating;
    if (!slug || !rating || typeof rating !== "object") continue;
    const r = rating as { min_premium?: unknown; amount?: unknown; model?: unknown };
    const annual = typeof r.min_premium === "number" ? r.min_premium : r.model === "flat" && typeof r.amount === "number" ? r.amount : null;
    if (annual == null || annual <= 0) continue;
    out[slug] = out[slug] == null ? annual : Math.min(out[slug], annual);
  }
  return out;
}

/** Lowest annual "from" price across several category slugs, as a monthly figure (GHS, rounded). */
export function monthlyFrom(prices: Record<string, number>, slugs: string[], fallbackMonthly: number): { monthly: number; source: "catalog" | "content" } {
  const annuals = slugs.map((s) => prices[s]).filter((v): v is number => typeof v === "number");
  if (!annuals.length) return { monthly: fallbackMonthly, source: "content" };
  return { monthly: Math.max(1, Math.round(Math.min(...annuals) / 12)), source: "catalog" };
}
