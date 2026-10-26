import "server-only";
import { log, mask } from "@/server/log";

/**
 * WhatsApp provider (Phase 1/2: renewal reminders, quote links, payment links).
 *
 *   WHATSAPP_PROVIDER = log (default) | meta
 *   meta = WhatsApp Cloud API: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and approved
 *   template names (WHATSAPP_TEMPLATE_RENEWAL, WHATSAPP_TEMPLATE_GENERIC, WHATSAPP_TEMPLATE_LANG).
 *
 * WhatsApp only delivers business-initiated messages through pre-approved templates, so every
 * send names a template and passes the title/body/link as positional body parameters. A plain
 * text message is attempted only inside an open 24-hour customer-service window.
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
  template?: string;
}

export interface WhatsAppProvider {
  readonly name: "log" | "meta";
  send(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
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

export const logWhatsAppProvider: WhatsAppProvider = {
  name: "log",
  async send(m) {
    log.info("whatsapp.log", { to: mask(normaliseWhatsAppNumber(m.to)), kind: m.kind, template: templateFor(m.kind), message: process.env.NODE_ENV === "production" ? undefined : whatsAppText(m) });
    return { ok: true, provider: "log", template: templateFor(m.kind) };
  },
};

const GRAPH = "https://graph.facebook.com/v21.0";

export const metaWhatsAppProvider: WhatsAppProvider = {
  name: "meta",
  async send(m) {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneId || !token) return { ok: false, provider: "meta", error: "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not set" };
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
    try {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
      if (!res.ok) {
        log.warn("whatsapp.failed", { status: res.status, code: json.error?.code, message: json.error?.message, template });
        return { ok: false, provider: "meta", status: res.status, error: json.error?.message ?? `HTTP ${res.status}`, template };
      }
      return { ok: true, provider: "meta", id: json.messages?.[0]?.id, status: res.status, template };
    } catch (err) {
      log.warn("whatsapp.error", { err });
      return { ok: false, provider: "meta", error: "network", template };
    }
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
