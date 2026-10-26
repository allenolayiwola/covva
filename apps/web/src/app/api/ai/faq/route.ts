import { RATE_LIMITS, withApi } from "@/server/api-auth";
import { faqStreamHandler } from "@/server/whatsapp/assistant";

export const maxDuration = 60;

/**
 * POST /api/ai/faq — anonymous FAQ assistant for the marketing site's "Chat with us"
 * drawer (`useChat` + `DefaultChatTransport`). Body: { messages }. No account data:
 * the only tool is the help-centre FAQ. Rate-limited per IP; the same guardrails as the
 * WhatsApp bot (no advice, no prices, hand off to a human or the broker).
 */
export const POST = withApi((ctx) => faqStreamHandler(ctx), { auth: "none", rateLimit: RATE_LIMITS.ai });
