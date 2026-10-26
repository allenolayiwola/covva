import { bundleQuote } from "@im/core";
import { withApi } from "@/server/api-auth";
import { listPublishedBundles } from "@/server/bundles";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * GET /api/v1/bundles — published product bundles (e.g. the Parents' Care Pack) with their items and an
 * indicative GHS total from the catalogue's lowest published premiums per category. The binding price is
 * always the insurer's quote; the bundle discount is applied only when the insurer confirms it.
 */
export const GET = withApi(
  async () => {
    const bundles = await listPublishedBundles();
    const slugs = [...new Set(bundles.flatMap((b) => b.parsedItems.map((i) => i.category_slug)))];
    const estimates: Record<string, number | null> = {};
    if (slugs.length) {
      const { data } = await createPublicClient().from("product_categories").select("id, slug").in("slug", slugs);
      for (const c of data ?? []) {
        const { data: v } = await createPublicClient().from("product_versions").select("base_premium, product:products!inner(category_id, status)").eq("product.category_id", c.id).eq("status", "approved").order("base_premium").limit(1);
        const p = Number((v?.[0] as { base_premium?: number | string } | undefined)?.base_premium);
        estimates[c.slug] = Number.isFinite(p) && p > 0 ? p : null;
      }
    }
    return {
      items: bundles.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
        audience: b.audience,
        items: b.parsedItems,
        discountPct: Number(b.discount_pct),
        quote: bundleQuote({ items: b.parsedItems, discount_pct: Number(b.discount_pct) }, estimates),
        getStartedUrl: `/get-started?bundle=${encodeURIComponent(b.slug)}`,
      })),
    };
  },
  { auth: "none" },
);
