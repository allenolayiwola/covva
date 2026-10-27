import "server-only";
import type { UssdReply, UssdRequest } from "./types";

/**
 * Arkesel USSD callback: JSON POST with `sessionID`, `userID`, `newSession` (bool), `msisdn`,
 * `userData` (the latest input; the dialled code on a new session) and `network`. One input per
 * hop (history kept by the engine). Reply JSON
 * `{ sessionID, userID, msisdn, message, continueSession }`.
 */
export async function parseArkesel(req: Request): Promise<UssdRequest & { userId?: string | null }> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" || typeof body[k] === "number" ? String(body[k]) : null);
  const isNew = body.newSession === true || body.newSession === "true";
  return {
    provider: "arkesel",
    sessionId: str("sessionID") ?? str("sessionId") ?? "",
    msisdn: str("msisdn") ?? "",
    serviceCode: null,
    network: str("network"),
    input: str("userData") ?? "",
    isNew,
    userId: str("userID"),
  };
}

export function formatArkesel(reply: UssdReply, req: UssdRequest & { userId?: string | null }): Response {
  return Response.json(
    { sessionID: req.sessionId, userID: req.userId ?? null, msisdn: req.msisdn, message: reply.text, continueSession: reply.type === "CON" },
    { headers: { "cache-control": "no-store" } },
  );
}
