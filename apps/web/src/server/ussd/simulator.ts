import "server-only";
import type { UssdReply, UssdRequest } from "./types";

/**
 * Staff simulator (admin `/ussd`): JSON `{ sessionId, phoneNumber, text, serviceCode? }` with
 * Africa's Talking semantics (`text` = whole history joined with `*`). Replies JSON
 * `{ type, text, chars }`. Always requires `USSD_SHARED_SECRET` outside development.
 */
export async function parseSimulator(req: Request): Promise<UssdRequest> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const sessionId = s("sessionId");
  return {
    provider: "simulator",
    sessionId: sessionId ? `sim-${sessionId}`.slice(0, 200) : "",
    msisdn: s("phoneNumber"),
    serviceCode: s("serviceCode") || process.env.USSD_SERVICE_CODE || "*920*44#",
    network: s("network") || null,
    text: s("text"),
    isNew: !s("text"),
  };
}

export function formatSimulator(reply: UssdReply): Response {
  return Response.json({ ok: true, data: { type: reply.type, text: reply.text, chars: reply.text.length } }, { headers: { "cache-control": "no-store" } });
}
