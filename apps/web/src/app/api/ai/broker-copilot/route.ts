import { BrokerCopilotInput } from "@im/core";
import { RATE_LIMITS, parseJson, withApi } from "@/server/api-auth";
import { brokerCopilot } from "@/server/ai/copilot";

export const maxDuration = 60;

/** POST /api/ai/broker-copilot — partner session. Summary, next actions and an "AI draft — review before sending" message. */
export const POST = withApi(
  async ({ auth, req }) => {
    const { requestId } = await parseJson(req, BrokerCopilotInput);
    return brokerCopilot(auth, requestId);
  },
  { auth: "user", rateLimit: RATE_LIMITS.ai },
);
