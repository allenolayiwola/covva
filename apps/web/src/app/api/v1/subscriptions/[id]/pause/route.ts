import { subscriptionSummary } from "@im/core";
import { uuidParam, withApi } from "@/server/api-auth";
import { pauseSubscription } from "@/server/subscriptions";

/** POST /api/v1/subscriptions/{id}/pause — stop collections until resumed (cover may lapse when a premium falls due). */
export const POST = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/subscriptions/[id]/pause">) => {
    const id = uuidParam((await route.params).id);
    const sub = await pauseSubscription(id, auth.userId);
    return { ...sub, summary: subscriptionSummary(sub) };
  },
  { auth: "user" },
);
