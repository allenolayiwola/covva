import { PayInstalmentInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { payInstalment } from "@/server/instalments";

/**
 * POST /api/v1/instalments/{id}/pay — pay an instalment now (earlier unpaid ones are included).
 * `mobile_money` pushes a prompt the payer approves; `card` charges the saved card; `link` returns a
 * hosted checkout URL. The money goes to the insurer in GHS.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/instalments/[id]/pay">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, PayInstalmentInput);
    return payInstalment(id, auth.userId, { channel: input.channel, momo: input.momo ?? null, paymentMethodId: input.paymentMethodId ?? null });
  },
  { auth: "user" },
);
