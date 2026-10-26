import { RATE_LIMITS, withApi } from "@/server/api-auth";
import { assistantHandler } from "@/server/ai/assistant";

export const maxDuration = 60;

/**
 * POST /api/ai/assistant — streaming customer assistant for `useChat` + `DefaultChatTransport`.
 * Body: { messages, requestId?, policyId?, threadId? }. Cookie session (web) or bearer token (mobile).
 * Response: UI message stream; header `x-thread-id` identifies the saved conversation.
 */
export const POST = withApi((ctx) => assistantHandler(ctx), { auth: "user", rateLimit: RATE_LIMITS.ai });
