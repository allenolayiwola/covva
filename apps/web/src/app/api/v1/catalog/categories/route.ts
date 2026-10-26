import { CATEGORY_AVAILABILITY } from "@im/core";
import { getCategories } from "@/lib/catalog";
import { withApi } from "@/server/api-auth";

/** GET /api/v1/catalog/categories — public; includes risk_schema for quote forms. */
export const GET = withApi(
  async () => {
    const categories = await getCategories();
    return categories.map((c) => ({
      ...c,
      availabilityLabel: CATEGORY_AVAILABILITY[c.availability].label,
      availabilityPromise: CATEGORY_AVAILABILITY[c.availability].promise,
    }));
  },
  { auth: "none" },
);
