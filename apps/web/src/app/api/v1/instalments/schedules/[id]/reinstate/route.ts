import { ReinstateScheduleInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { reinstate } from "@/server/instalments";

/**
 * POST /api/v1/instalments/schedules/{id}/reinstate — pay the arrears on a lapsed schedule within the
 * insurer's reinstatement window. When the plan requires it the insurer reviews before cover resumes.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/instalments/schedules/[id]/reinstate">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, ReinstateScheduleInput);
    return reinstate(id, auth.userId, { channel: input.channel, momo: input.momo ?? null, paymentMethodId: input.paymentMethodId ?? null });
  },
  { auth: "user" },
);
