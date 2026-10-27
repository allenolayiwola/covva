import { MicroProductsQuery } from "@im/core";
import { parseQuery, withApi } from "@/server/api-auth";
import { createPublicClient } from "@/lib/supabase/server";
import { listMicroProducts } from "@/server/micro";

/** GET /api/v1/micro/products?audience= — published micro products with "from GH₵ X/day" prices. */
export const GET = withApi(
  async ({ req }) => {
    const { audience } = parseQuery(req, MicroProductsQuery);
    const items = await listMicroProducts(createPublicClient(), audience ?? null);
    return { items };
  },
  { auth: "none" },
);
