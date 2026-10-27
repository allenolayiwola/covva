import "server-only";
import type { UssdReply, UssdRequest } from "./types";

/**
 * Hubtel USSD (programmable services) callback: JSON POST with `Type`
 * (`Initiation` | `Response` | `Release` | `Timeout`), `Message` (the latest input; on
 * Initiation the dialled string), `SessionId`, `Mobile`, `ServiceCode`, `Operator`, `Sequence`.
 * Hubtel sends ONE input per hop, so the engine keeps the history in `ussd_sessions.state`.
 * Reply JSON `{ SessionId, Type: "Response" | "Release", Message, Label, DataType, FieldType }`.
 * Field names differ slightly between Hubtel products (USSD vs. Programmable Services) — both
 * spellings are accepted here; confirm against the account's docs when the short code is live.
 */
export async function parseHubtel(req: Request): Promise<UssdRequest> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof body[k] === "string" || typeof body[k] === "number") return String(body[k]);
    return null;
  };
  const type = (pick("Type", "type") ?? "").toLowerCase();
  return {
    provider: "hubtel",
    sessionId: pick("SessionId", "sessionId", "sessionID") ?? "",
    msisdn: pick("Mobile", "mobile", "msisdn") ?? "",
    serviceCode: pick("ServiceCode", "serviceCode"),
    network: pick("Operator", "operator"),
    input: pick("Message", "message") ?? "",
    isNew: type === "initiation",
    isRelease: type === "release" || type === "timeout",
  };
}

export function formatHubtel(reply: UssdReply, req: UssdRequest): Response {
  return Response.json(
    { SessionId: req.sessionId, Type: reply.type === "CON" ? "Response" : "Release", Message: reply.text, Label: "Covva", DataType: "input", FieldType: "text", ClientState: "" },
    { headers: { "cache-control": "no-store" } },
  );
}
