import { CATEGORY_AVAILABILITY } from "@im/core";
import { getCategory, getFlags, getProductsForCategory } from "@/lib/catalog";
import { notFound, withApi } from "@/server/api-auth";

/** GET /api/v1/catalog/categories/{slug} — category, risk_schema and approved products. */
export const GET = withApi(
  async (_ctx, route: RouteContext<"/api/v1/catalog/categories/[slug]">) => {
    const { slug } = await route.params;
    const category = await getCategory(slug);
    if (!category) throw notFound("Unknown insurance category.");
    const [products, flags] = await Promise.all([getProductsForCategory(category.id), getFlags()]);
    return {
      category: {
        ...category,
        availabilityLabel: CATEGORY_AVAILABILITY[category.availability].label,
        availabilityPromise: CATEGORY_AVAILABILITY[category.availability].promise,
      },
      products: products.map((p) => ({ ...p, demo: !!(p.insurer?.settings as { demo?: boolean } | null)?.demo })),
      productsCount: products.length,
      insurersCount: new Set(products.map((p) => p.insurer?.id).filter(Boolean)).size,
      demoMode: !!flags.demo_mode,
    };
  },
  { auth: "none" },
);
