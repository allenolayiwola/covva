import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { nextMessageStatus, parseWebhookPayload, type WaStatusUpdate } from "@im/core";
import { log } from "@/server/log";
import { whatsAppProvider } from "@/server/providers/whatsapp";
import { routeInbound } from "./router";
import type { Svc } from "./sender";

/**
 * Meta Cloud API webhook plumbing.
 *
 *  - GET verification: Meta calls `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`;
 *    we echo the challenge when the token equals WHATSAPP_VERIFY_TOKEN.
 *  - POST events: `X-Hub-Signature-256: sha256=<hmac>` over the raw body with
 *    WHATSAPP_APP_SECRET. Parsing is pure (`parseWebhookPayload` in @im/core); this module
 *    applies the result: inbound messages go through the router, delivery statuses update
 *    the matching outbound rows.
 */
export function verifyChallenge(params: URLSearchParams): { ok: true; challenge: string } | { ok: false; status: number } {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return { ok: false, status: 503 };
  const mode = params.get("hub.mode");
  const given = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !challenge) return { ok: false, status: 400 };
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 403 };
  return { ok: true, challenge };
}

/** HMAC-SHA256 of the raw body with the app secret, compared in constant time. */
export function verifySignature(rawBody: string, header: string | null, secret = process.env.WHATSAPP_APP_SECRET): boolean {
  if (!secret) return process.env.NODE_ENV !== "production" && (process.env.WHATSAPP_PROVIDER ?? "log") === "log";
  if (!header) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(m[1]!.toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WebhookOutcome {
  messages: number;
  statuses: number;
  duplicates: number;
  actions: string[];
}

/** Apply a parsed webhook body: route inbound messages (in order) and update outbound statuses. */
export async function handleWebhook(svc: Svc, body: unknown): Promise<WebhookOutcome> {
  const parsed = parseWebhookPayload(body);
  const out: WebhookOutcome = { messages: 0, statuses: 0, duplicates: 0, actions: [] };
  const ourPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  for (const m of parsed.messages) {
    if (ourPhoneId && m.phoneNumberId && m.phoneNumberId !== ourPhoneId) {
      log.warn("whatsapp.webhook_other_number", { phoneNumberId: m.phoneNumberId });
      continue;
    }
    out.messages++;
    try {
      const r = await routeInbound(svc, m);
      if (r.duplicate) out.duplicates++;
      out.actions.push(r.action);
      if (!r.duplicate) void whatsAppProvider().markRead(m.waMessageId).catch(() => {});
    } catch (err) {
      log.error("whatsapp.route_failed", { waMessageId: m.waMessageId, err });
      out.actions.push("error");
    }
  }
  for (const s of parsed.statuses) {
    out.statuses++;
    await applyStatus(svc, s);
  }
  return out;
}

export async function applyStatus(svc: Svc, s: WaStatusUpdate): Promise<void> {
  const { data: row } = await svc.from("wa_messages").select("id, status").eq("wa_message_id", s.waMessageId).maybeSingle();
  if (!row) return; // not ours (or logged by the Phase 1 path before conversations existed)
  const next = nextMessageStatus(row.status, s.status);
  if (!next) return;
  await svc.from("wa_messages").update({ status: next, ...(s.error ? { error: s.error.slice(0, 500) } : {}) }).eq("id", row.id);
  if (next === "failed") log.warn("whatsapp.delivery_failed", { waMessageId: s.waMessageId, error: s.error });
}
