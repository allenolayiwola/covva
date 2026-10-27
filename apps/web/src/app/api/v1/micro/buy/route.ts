import { MicroBuyInput } from "@im/core";
import { parseJson, withApi } from "@/server/api-auth";
import { buyMicroCover } from "@/server/micro";

/**
 * POST /api/v1/micro/buy — one-step micro purchase. Instant (L2) products return the payment
 * (MoMo prompt to approve, or a checkout URL); other products return the routed request.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, MicroBuyInput);
    const r = await buyMicroCover(auth.userId, input.productVersionId, input.period, input.channel, { payment: input.payment, momo: input.momo ?? null, autoRenew: input.autoRenew, risk: input.risk });
    return Response.json({ ok: true, data: r }, { status: 201 });
  },
  { auth: "user" },
);
