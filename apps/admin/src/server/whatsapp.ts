import "server-only";
import {
  WA_TEMPLATES,
  buildInteractivePayload,
  buildTemplatePayload,
  buildTextPayload,
  canSend,
  isWaTemplateName,
  renderTemplatePreview,
  templateParams,
  type WaInteractiveButton,
  type WaOutboundPayload,
} from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Outbound WhatsApp from the admin console (support replies). Same rules as the web app's
 * `server/whatsapp/sender.ts`: opted-out contacts get nothing, free-form text only inside
 * the 24-hour window, templates otherwise; every message is logged in `wa_messages`.
 * The Meta call is the minimal Cloud API POST; `WHATSAPP_PROVIDER=log` only logs.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type WaContact = Row<"wa_contacts">;

export interface SendOutcome {
  ok: boolean;
  messageId: string | null;
  error?: string;
}

function payloadText(payload: Record<string, unknown>): string {
  if (payload.type === "text") return String((payload.text as { body?: string })?.body ?? "");
  if (payload.type === "template") {
    const t = payload.template as { name: string; components?: { type: string; parameters?: { text?: string }[] }[] };
    const params = (t.components ?? []).find((c) => c.type === "body")?.parameters?.map((p) => p.text ?? "") ?? [];
    return isWaTemplateName(t.name) ? renderTemplatePreview(t.name, params) : `[${t.name}] ${params.join(" | ")}`;
  }
  if (payload.type === "interactive") return String((payload.interactive as { body?: { text?: string } })?.body?.text ?? "");
  return `[${String(payload.type)}]`;
}

async function callMeta(payload: WaOutboundPayload): Promise<{ ok: boolean; id?: string; error?: string }> {
  if ((process.env.WHATSAPP_PROVIDER ?? "log").toLowerCase() !== "meta") {
    console.log(JSON.stringify({ level: "info", msg: "whatsapp.log", service: "admin", type: payload.type, message: process.env.NODE_ENV === "production" ? undefined : payloadText(payload as unknown as Record<string, unknown>) }));
    return { ok: true, id: `log.${Date.now()}` };
  }
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return { ok: false, error: "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not set on the admin project" };
  try {
    const res = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0"}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) return { ok: false, error: `${json.error?.code ? `${json.error.code} ` : ""}${json.error?.message ?? `HTTP ${res.status}`}` };
    return { ok: true, id: json.messages?.[0]?.id };
  } catch {
    return { ok: false, error: "network" };
  }
}

async function dispatch(svc: Svc, contact: WaContact, conversationId: string, payload: WaOutboundPayload, meta: { kind: "text" | "template" | "interactive"; templateName?: string; senderUserId: string; sender: "support" | "broker" | "system" }): Promise<SendOutcome> {
  const gate = canSend(contact, meta.kind);
  if (!gate.ok) return { ok: false, messageId: null, error: gate.reason === "opted_out" ? "This contact opted out of WhatsApp messages." : "The 24-hour window is closed: send an approved template instead of free text." };
  const { data: row } = await svc
    .from("wa_messages")
    .insert({ conversation_id: conversationId, direction: "out", kind: meta.kind, body: payloadText(payload as unknown as Record<string, unknown>), payload: payload as unknown as Json, template_name: meta.templateName ?? null, status: "queued", sender_party: meta.sender, sender_user_id: meta.senderUserId })
    .select("id")
    .single();
  const r = await callMeta(payload);
  if (row) await svc.from("wa_messages").update(r.ok ? { status: "sent", wa_message_id: r.id ?? null } : { status: "failed", error: (r.error ?? "send failed").slice(0, 500) }).eq("id", row.id);
  return { ok: r.ok, messageId: row?.id ?? null, error: r.error };
}

export function sendText(svc: Svc, contact: WaContact, conversationId: string, text: string, by: string) {
  return dispatch(svc, contact, conversationId, buildTextPayload(contact.phone, text), { kind: "text", senderUserId: by, sender: "support" });
}

export function sendInteractive(svc: Svc, contact: WaContact, conversationId: string, body: string, buttons: WaInteractiveButton[], by: string) {
  return dispatch(svc, contact, conversationId, buildInteractivePayload(contact.phone, body, buttons), { kind: "interactive", senderUserId: by, sender: "support" });
}

export async function sendTemplate(svc: Svc, contact: WaContact, conversationId: string, name: string, values: Record<string, unknown>, by: string): Promise<SendOutcome> {
  const { data: registered } = await svc.from("wa_templates").select("name, language, status, variables, body").eq("name", name).maybeSingle();
  const def = isWaTemplateName(name) ? WA_TEMPLATES[name] : registered ? { variables: registered.variables, body: registered.body } : null;
  if (!def) return { ok: false, messageId: null, error: `Unknown template "${name}".` };
  if ((process.env.WHATSAPP_PROVIDER ?? "log").toLowerCase() === "meta" && registered && registered.status !== "approved") return { ok: false, messageId: null, error: `Template "${name}" is ${registered.status}; Meta only delivers approved templates.` };
  const payload = buildTemplatePayload(contact.phone, name, registered?.language ?? process.env.WHATSAPP_TEMPLATE_LANG ?? "en", templateParams(def, values));
  return dispatch(svc, contact, conversationId, payload, { kind: "template", templateName: name, senderUserId: by, sender: "support" });
}
