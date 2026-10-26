import { ShareQuotesInput } from "@im/core";
import { RATE_LIMITS, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { shareQuotes } from "@/server/shares";

/**
 * POST /api/v1/requests/{id}/share — save & share the comparison. Returns the public link
 * (`url`, valid 14 days), the WhatsApp deep link (`whatsappUrl`) and the plain `text`.
 * `channel: "email"` also emails the summary to `email`. The public page never shows who you are.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/requests/[id]/share">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, ShareQuotesInput);
    const share = await shareQuotes(auth.supabase, auth.userId, id, input.channel, { email: input.email ?? auth.email });
    return Response.json({ ok: true, data: share }, { status: 201 });
  },
  { auth: "user", rateLimit: RATE_LIMITS.write },
);
