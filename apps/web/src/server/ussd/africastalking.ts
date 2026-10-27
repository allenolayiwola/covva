import "server-only";
import type { UssdReply, UssdRequest } from "./types";

/**
 * Africa's Talking USSD callback: `application/x-www-form-urlencoded` POST with
 * `sessionId`, `serviceCode`, `phoneNumber`, `networkCode` and `text` (the whole session's input
 * joined with `*`, empty on the first hop). Reply `text/plain` starting `CON ` (continue) or
 * `END ` (close). AT does not sign callbacks: put `?key=<USSD_SHARED_SECRET>` in the callback URL
 * and allowlist AT's IPs.
 */
export async function parseAfricasTalking(req: Request): Promise<UssdRequest> {
  const form = new URLSearchParams(await req.text());
  return {
    provider: "africastalking",
    sessionId: form.get("sessionId") ?? "",
    msisdn: form.get("phoneNumber") ?? "",
    serviceCode: form.get("serviceCode"),
    network: networkFromCode(form.get("networkCode")),
    text: form.get("text") ?? "",
    isNew: !form.get("text"),
  };
}

/** AT network codes for Ghana (62001 MTN, 62002 Telecel/Vodafone, 62003/62006 AirtelTigo). */
function networkFromCode(code: string | null): string | null {
  switch (code) {
    case "62001":
      return "mtn";
    case "62002":
      return "telecel";
    case "62003":
    case "62006":
      return "airteltigo";
    default:
      return code;
  }
}

export function formatAfricasTalking(reply: UssdReply): Response {
  return new Response(`${reply.type} ${reply.text}`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
