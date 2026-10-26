import { DEMO_DISCLAIMER } from "@im/core";
import { getFlags } from "@/lib/catalog";
import { notFound, uuidParam, withApi } from "@/server/api-auth";
import { loadQuotesForRequest } from "@/server/quotes";

/** GET /api/v1/requests/{id}/quotes — quotes, comparison (engine output) and disclosure text. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/requests/[id]/quotes">) => {
    const id = uuidParam((await route.params).id);
    const [r, flags] = await Promise.all([loadQuotesForRequest(auth.supabase, id), getFlags()]);
    if (!r) throw notFound("Request not found.");
    return { ...r, demoMode: !!flags.demo_mode, demoDisclaimer: flags.demo_mode ? DEMO_DISCLAIMER : null };
  },
  { auth: "user" },
);
