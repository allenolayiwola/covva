import { z } from "zod";
import { subscriptionSummary } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { cancelSubscription } from "@/server/subscriptions";

const Body = z.object({ reason: z.string().trim().max(500).optional() });

/** POST /api/v1/subscriptions/{id}/cancel — no further collections; existing cover runs to its end date. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/subscriptions/[id]/cancel">) => {
    const id = uuidParam((await route.params).id);
    const { reason } = await parseJson(req, Body);
    const sub = await cancelSubscription(id, auth.userId, reason);
    return { ...sub, summary: subscriptionSummary(sub) };
  },
  { auth: "user" },
);
