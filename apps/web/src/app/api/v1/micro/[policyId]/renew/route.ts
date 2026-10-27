import { MicroRenewInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { renewMicro } from "@/server/micro";

/** POST /api/v1/micro/{policyId}/renew — one-tap renewal; the next window starts when the current one ends. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/micro/[policyId]/renew">) => {
    const policyId = uuidParam((await route.params).policyId, "policyId");
    const input = await parseJson(req, MicroRenewInput);
    return renewMicro(policyId, auth.userId, { period: input.period, channel: input.channel, momo: input.momo ?? null, paymentMethodId: input.paymentMethodId ?? null, sessionChannel: "app" });
  },
  { auth: "user" },
);
