import { MicroUpdateInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { setMicroAutoRenew } from "@/server/micro";

/** PATCH /api/v1/micro/{policyId} — turn auto-renew on or off. */
export const PATCH = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/micro/[policyId]">) => {
    const policyId = uuidParam((await route.params).policyId, "policyId");
    const input = await parseJson(req, MicroUpdateInput);
    return setMicroAutoRenew(policyId, auth.userId, input.autoRenew);
  },
  { auth: "user" },
);
