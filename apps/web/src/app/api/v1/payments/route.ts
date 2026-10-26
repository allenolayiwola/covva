import { InitPaymentRequest } from "@im/core";
import { parseJson, withApi } from "@/server/api-auth";
import { initiatePayment } from "@/server/payments";

/**
 * POST /api/v1/payments — start paying for a submitted application. Returns a hosted
 * checkout URL (open it in an in-app browser) or, for a direct MoMo prompt, `authorizationUrl: null`.
 * Payment confirmation never activates cover: the insurer issues the policy afterwards.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, InitPaymentRequest);
    const result = await initiatePayment({ ...input, userId: auth.userId });
    return Response.json({ ok: true, data: result }, { status: 201 });
  },
  { auth: "user" },
);
