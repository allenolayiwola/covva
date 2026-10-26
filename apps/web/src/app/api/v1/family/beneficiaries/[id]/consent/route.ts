import { RequestConsentInput } from "@im/core";
import { RATE_LIMITS, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { sendConsentCode } from "@/server/diaspora";

type Route = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/family/beneficiaries/{id}/consent — send a 6-digit consent code (and a signed accept link)
 * to the beneficiary's phone by SMS or WhatsApp. The code is never returned to the sponsor.
 */
export const POST = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const id = uuidParam((await params).id);
    const input = await parseJson(req, RequestConsentInput);
    const r = await sendConsentCode(auth.supabase, auth.userId, id, input.kind, input.channel);
    return { ...r, message: `We sent a code to ${r.sentTo}. Ask them to read it to you, or they can tap the link to accept.` };
  },
  { auth: "user", rateLimit: RATE_LIMITS.ai },
);
