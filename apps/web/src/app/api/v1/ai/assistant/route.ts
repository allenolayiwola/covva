import { RATE_LIMITS, withApi } from "@/server/api-auth";
import { assistantHandler } from "@/server/ai/assistant";

export const maxDuration = 60;

/** POST /api/v1/ai/assistant — streaming customer assistant (UI message stream; same as /api/ai/assistant). */
export const POST = withApi((ctx) => assistantHandler(ctx), { auth: "user", rateLimit: RATE_LIMITS.ai });
