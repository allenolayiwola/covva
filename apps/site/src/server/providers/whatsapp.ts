import "server-only";
import { renderTemplatePreview, isWaTemplateName, type WaOutboundPayload } from "@im/core";
import { log, mask } from "@/server/log";

/**
 * WhatsApp provider (Phase 1 notifications + Phase 2 conversations).
 *
 *   WHATSAPP_PROVIDER = log (default) | meta
 *   meta = WhatsApp Cloud API: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and approved
 *   template names (WHATSAPP_TEMPLATE_RENEWAL, WHATSAPP_TEMPLATE_GENERIC, WHATSAPP_TEMPLATE_LANG).
 *
 * Two entry points:
 *   - `send(message)` — the Phase 1 notification path: picks a generic template for a
 *     notification kind and passes title/body/link as positional body parameters.
 *   - `sendPayload(payload)` — Phase 2: any Cloud API payload (text, template with buttons,
 *     interactive reply buttons, media). `server/whatsapp/sender.ts` builds the payloads,
 *     enforces the 24-hour window / opt-outs and logs every message in `wa_messages`.
 *
 * WhatsApp only delivers business-initiated messages through pre-approved templates, so a
 * plain text message is attempted only inside an open 24-hour customer-service window.
 */
export interface WhatsAppMessage {
  /** E.164 or local Ghana number; normalised to 233… */
  to: string;
  /** Notification kind — picks the template (e.g. "renewal.reminder"). */
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

export interface WhatsAppSendResult {
  ok: boolean;
  provider: "log" | "meta";
  id?: string;
  status?: number;
  error?: string;
  /** Meta error code (e.g. 131047 re-engagement = outside the 24h window, 131026 = not a WhatsApp user). */
  code?: number;
  template?: string;
}

export interface WhatsAppProvider {
  readonly name: "log" | "meta";
  send(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
  /** Send a raw Cloud API payload (text / template / interactive / media). */
  sendPayload(payload: WaOutboundPayload | Record<string, unknown>): Promise<WhatsAppSendResult>;
  /** Mark an inbound message as read (shows the blue ticks). Best effort. */
  markRead(waMessageId: string): Promise<void>;
}

/** Normalise Ghana numbers to 233XXXXXXXXX (no plus), as the Cloud API expects. */
export function normaliseWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

/** Template name for a notification kind (env-configurable; falls back to the generic template). */
export function templateFor(kind: string): string {
  if (kind.startsWith("renewal.")) return process.env.WHATSAPP_TEMPLATE_RENEWAL ?? "covva_renewal_reminder";
  if (kind.startsWith("quote.")) return process.env.WHATSAPP_TEMPLATE_QUOTE ?? process.env.WHATSAPP_TEMPLATE_GENERIC ?? "covva_update";
  if (kind.startsWith("payment.")) return process.env.WHATSAPP_TEMPLATE_PAYMENT ?? process.env.WHATSAPP_TEMPLATE_GENERIC ?? "covva_update";
  return process.env.WHATSAPP_TEMPLATE_GENERIC ?? "covva_update";
}

/** Plain-text rendering (log provider and session messages). */
export function whatsAppText(m: Pick<WhatsAppMessage, "title" | "body" | "link">): string {
  return [m.title, m.body ?? "", m.link ?? ""].filter(Boolean).join("\n");
}

/** Human-readable rendering of any outbound payload (log provider, admin previews). */
export function payloadText(payload: Record<string, unknown>): string {
  const type = payload.type;
  if (type === "text") return String((payload.text as { body?: string } | undefined)?.body ?? "");
  if (type === "template") {
    const t = payload.template as { name: string; components?: { type: string; parameters?: { text?: string; payload?: string }[] }[] } | undefined;
    if (!t) return "";
    const params = (t.components ?? []).find((c) => c.type === "body")?.parameters?.map((p) => p.text ?? "") ?? [];
    const buttons = (t.components ?? []).filter((c) => c.type === "button").map((c) => c.parameters?.[0]?.payload ?? "").filter(Boolean);
    const body = isWaTemplateName(t.name) ? renderTemplatePreview(t.name, params) : `[${t.name}] ${params.join(" | ")}`;
    return buttons.length ? `${body}\n[buttons: ${buttons.join(", ")}]` : body;
  }
  if (type === "interactive") {
    const i = payload.interactive as { body?: { text?: string }; action?: { buttons?: { reply?: { title?: string } }[] } } | undefined;
    return `${i?.body?.text ?? ""}\n[${(i?.action?.buttons ?? []).map((b) => b.reply?.title).filter(Boolean).join(" | ")}]`;
  }
  return `[${String(type)}]`;
}

let logCounter = 0;

export const logWhatsAppProvider: WhatsAppProvider = {
  name: "log",
  async send(m) {
    log.info("whatsapp.log", { to: mask(normaliseWhatsAppNumber(m.to)), kind: m.kind, template: templateFor(m.kind), message: process.env.NODE_ENV === "production" ? undefined : whatsAppText(m) });
    return { ok: true, provider: "log", template: templateFor(m.kind), id: `log.${Date.now()}.${++logCounter}` };
  },
  async sendPayload(payload) {
    const p = payload as Record<string, unknown>;
    log.info("whatsapp.log", { to: mask(String(p.to ?? "")), type: p.type, message: process.env.NODE_ENV === "production" ? undefined : payloadText(p) });
    return { ok: true, provider: "log", id: `log.${Date.now()}.${++logCounter}`, template: p.type === "template" ? (p.template as { name: string }).name : undefined };
  },
  async markRead() {},
};

const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0"}`;

async function graphPost(path: string, body: unknown): Promise<WhatsAppSendResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return { ok: false, provider: "meta", error: "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not set" };
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneId)}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) {
      log.warn("whatsapp.failed", { status: res.status, code: json.error?.code, message: json.error?.message });
      return { ok: false, provider: "meta", status: res.status, code: json.error?.code, error: json.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, provider: "meta", id: json.messages?.[0]?.id, status: res.status };
  } catch (err) {
    log.warn("whatsapp.error", { err });
    return { ok: false, provider: "meta", error: "network" };
  }
}

export const metaWhatsAppProvider: WhatsAppProvider = {
  name: "meta",
  async send(m) {
    const template = templateFor(m.kind);
    const to = normaliseWhatsAppNumber(m.to);
    // Template parameters cannot contain newlines or more than 1024 characters.
    const clean = (s: string | null | undefined, max: number) => (s ?? "—").replace(/\s*\n+\s*/g, " ").trim().slice(0, max) || "—";
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: clean(m.title, 200) },
              { type: "text", text: clean(m.body, 600) },
              { type: "text", text: clean(m.link, 300) },
            ],
          },
        ],
      },
    };
    const r = await graphPost("/messages", payload);
    return { ...r, template };
  },
  async sendPayload(payload) {
    const p = payload as Record<string, unknown>;
    const r = await graphPost("/messages", payload);
    return { ...r, template: p.type === "template" ? (p.template as { name: string }).name : undefined };
  },
  async markRead(waMessageId) {
    await graphPost("/messages", { messaging_product: "whatsapp", status: "read", message_id: waMessageId });
  },
};

export function whatsAppProvider(): WhatsAppProvider {
  return (process.env.WHATSAPP_PROVIDER ?? "log").toLowerCase() === "meta" ? metaWhatsAppProvider : logWhatsAppProvider;
}

/** True when WhatsApp sends can actually reach a phone (meta configured) — used to decide SMS fallback. */
export function whatsAppLive(): boolean {
  return (process.env.WHATSAPP_PROVIDER ?? "log").toLowerCase() === "meta" && !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_ACCESS_TOKEN;
}

export async function sendWhatsApp(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
  return whatsAppProvider().send(message);
}

/** Send any Cloud API payload through the configured provider. Prefer `server/whatsapp/sender.ts`, which logs and enforces the rules. */
export async function sendWhatsAppPayload(payload: WaOutboundPayload | Record<string, unknown>): Promise<WhatsAppSendResult> {
  return whatsAppProvider().sendPayload(payload);
}
