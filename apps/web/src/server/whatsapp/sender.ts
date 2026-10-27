import "server-only";
import {
  WA_BUTTON,
  WA_TEMPLATES,
  buildInteractivePayload,
  buildTemplatePayload,
  buildTextPayload,
  canSend,
  isWaTemplateName,
  normaliseWaPhone,
  phoneVariants,
  templateForNotificationKind,
  templateParams,
  waIdFromPhone,
  type WaInteractiveButton,
  type WaOutboundPayload,
  type WaTemplateName,
} from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log, mask } from "@/server/log";
import { payloadText, sendWhatsApp, whatsAppLive, whatsAppProvider, type WhatsAppSendResult } from "@/server/providers/whatsapp";

/**
 * Outbound WhatsApp (Phase 2). Every send goes through `dispatch()`, which:
 *   1. refuses opted-out contacts and free-form messages outside the 24-hour window
 *      (templates are the only thing allowed outside it),
 *   2. logs the message in `wa_messages` (queued → sent | failed), inside a conversation,
 *   3. calls the provider (`log` or Meta Cloud API).
 *
 * This module must not import `server/notify.ts` (notify imports it for the whatsapp channel).
 */
export type Svc = ReturnType<typeof createServiceClient>;
export type WaContact = Row<"wa_contacts">;
export type WaConversation = Row<"wa_conversations">;
type Sender = "bot" | "support" | "broker" | "system";

export interface SendOptions {
  conversationId?: string | null;
  sender?: Sender;
  senderUserId?: string | null;
}

export interface SendOutcome {
  ok: boolean;
  /** `wa_messages.id` of the logged row (null when nothing was logged). */
  messageId: string | null;
  waMessageId: string | null;
  error?: string;
  reason?: "opted_out" | "outside_window" | "template_not_approved" | "provider" | "unconfigured";
  provider?: WhatsAppSendResult["provider"];
}

export function svcOrNull(): Svc | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contacts and conversations
// ---------------------------------------------------------------------------
/** Find the user whose profile phone matches this number (any of its spellings). */
export async function findUserByPhone(svc: Svc, e164: string): Promise<string | null> {
  const variants = phoneVariants(e164);
  const { data } = await svc.from("profiles").select("id").in("phone", variants).limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * Get or create the contact for a phone number, linking it to a profile when the number is
 * known. Never flips opt-out state; `markInbound()` and `optOut()` do that.
 */
export async function ensureContact(svc: Svc, phone: string, opts: { displayName?: string | null; userId?: string | null } = {}): Promise<WaContact | null> {
  const e164 = normaliseWaPhone(phone);
  if (!e164) return null;
  const { data: existing } = await svc.from("wa_contacts").select("*").eq("phone", e164).maybeSingle();
  if (existing) {
    const patch: Partial<WaContact> = {};
    if (!existing.user_id) {
      const userId = opts.userId ?? (await findUserByPhone(svc, e164));
      if (userId) patch.user_id = userId;
    }
    if (opts.displayName && opts.displayName !== existing.display_name) patch.display_name = opts.displayName.slice(0, 120);
    if (Object.keys(patch).length) {
      const { data: updated } = await svc.from("wa_contacts").update(patch).eq("id", existing.id).select("*").single();
      return updated ?? existing;
    }
    return existing;
  }
  const userId = opts.userId ?? (await findUserByPhone(svc, e164));
  const { data: created, error } = await svc
    .from("wa_contacts")
    .insert({ phone: e164, wa_id: waIdFromPhone(e164), user_id: userId, display_name: opts.displayName?.slice(0, 120) ?? null })
    .select("*")
    .single();
  if (error) {
    // Lost a race with a concurrent webhook: read the winner.
    const { data: again } = await svc.from("wa_contacts").select("*").eq("phone", e164).maybeSingle();
    if (again) return again;
    log.warn("whatsapp.contact_insert_failed", { phone: mask(e164), err: error });
    return null;
  }
  return created;
}

/** The latest open conversation for a contact, or a fresh `bot` one. */
export async function openConversation(svc: Svc, contactId: string, defaults: Partial<Pick<WaConversation, "status" | "topic" | "assigned_org_id" | "request_id" | "policy_id" | "claim_id">> = {}): Promise<WaConversation | null> {
  const { data: current } = await svc.from("wa_conversations").select("*").eq("contact_id", contactId).neq("status", "closed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (current) return current;
  const { data: created, error } = await svc
    .from("wa_conversations")
    .insert({ contact_id: contactId, status: defaults.status ?? "bot", topic: defaults.topic ?? null, assigned_org_id: defaults.assigned_org_id ?? null, request_id: defaults.request_id ?? null, policy_id: defaults.policy_id ?? null, claim_id: defaults.claim_id ?? null })
    .select("*")
    .single();
  if (error) log.warn("whatsapp.conversation_insert_failed", { contactId, err: error });
  return created ?? null;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
async function dispatch(svc: Svc, contact: WaContact, payload: WaOutboundPayload, meta: { kind: Row<"wa_messages">["kind"]; templateName?: string | null } & SendOptions): Promise<SendOutcome> {
  const gate = canSend(contact, meta.kind === "template" ? "template" : meta.kind === "interactive" ? "interactive" : "text");
  if (!gate.ok) {
    log.info("whatsapp.blocked", { contact: contact.id, reason: gate.reason, kind: meta.kind });
    return { ok: false, messageId: null, waMessageId: null, reason: gate.reason, error: gate.reason === "opted_out" ? "The contact opted out of WhatsApp messages." : "Outside the 24-hour window: only an approved template can be sent." };
  }
  const conversationId = meta.conversationId ?? (await openConversation(svc, contact.id))?.id ?? null;
  if (!conversationId) return { ok: false, messageId: null, waMessageId: null, reason: "provider", error: "Could not open a conversation." };
  const body = payloadText(payload as unknown as Record<string, unknown>);
  const { data: row } = await svc
    .from("wa_messages")
    .insert({
      conversation_id: conversationId,
      direction: "out",
      kind: meta.kind,
      body,
      payload: payload as unknown as Json,
      template_name: meta.templateName ?? null,
      status: "queued",
      sender_party: meta.sender ?? "system",
      sender_user_id: meta.senderUserId ?? null,
    })
    .select("id")
    .single();
  const r = await whatsAppProvider().sendPayload(payload);
  if (row) {
    await svc
      .from("wa_messages")
      .update(r.ok ? { status: "sent", wa_message_id: r.id ?? null } : { status: "failed", error: `${r.code ? `${r.code} ` : ""}${r.error ?? "send failed"}`.slice(0, 500) })
      .eq("id", row.id);
  }
  // Meta 131047: re-engagement needed (window closed on their side) — nothing else to do but log it.
  return { ok: r.ok, messageId: row?.id ?? null, waMessageId: r.id ?? null, error: r.error, reason: r.ok ? undefined : "provider", provider: r.provider };
}

/** Free-form text (only inside the 24-hour window). */
export async function sendText(svc: Svc, contact: WaContact, text: string, opts: SendOptions = {}): Promise<SendOutcome> {
  return dispatch(svc, contact, buildTextPayload(contact.phone, text), { kind: "text", ...opts });
}

/** Interactive reply buttons (inside the window). */
export async function sendInteractive(svc: Svc, contact: WaContact, body: string, buttons: WaInteractiveButton[], opts: SendOptions & { header?: string; footer?: string } = {}): Promise<SendOutcome> {
  return dispatch(svc, contact, buildInteractivePayload(contact.phone, body, buttons, { header: opts.header, footer: opts.footer }), { kind: "interactive", ...opts });
}

/**
 * An approved template (allowed outside the window). Values are named per `WA_TEMPLATES[name].variables`
 * or positional. `buttons` attach quick-reply payloads (e.g. the offer accept token).
 */
export async function sendTemplate(
  svc: Svc,
  contact: WaContact,
  name: WaTemplateName | string,
  values: Record<string, unknown> | readonly unknown[],
  opts: SendOptions & { buttons?: { index: number; payload?: string; urlSuffix?: string }[]; language?: string } = {},
): Promise<SendOutcome> {
  const { data: registered } = await svc.from("wa_templates").select("name, language, status, variables, body").eq("name", name).maybeSingle();
  const def = isWaTemplateName(name) ? WA_TEMPLATES[name] : registered ? { variables: registered.variables, body: registered.body } : null;
  if (!def) return { ok: false, messageId: null, waMessageId: null, reason: "template_not_approved", error: `Unknown template "${name}".` };
  if (whatsAppLive() && registered && registered.status !== "approved") {
    log.warn("whatsapp.template_not_approved", { name, status: registered.status });
    return { ok: false, messageId: null, waMessageId: null, reason: "template_not_approved", error: `Template "${name}" is ${registered.status}, not approved by Meta yet.` };
  }
  const params = templateParams(def, values);
  const language = opts.language ?? registered?.language ?? process.env.WHATSAPP_TEMPLATE_LANG ?? "en";
  return dispatch(svc, contact, buildTemplatePayload(contact.phone, name, language, params, opts.buttons ?? []), { kind: "template", templateName: name, ...opts });
}

/** Offer the bot's escape hatches (human / broker / keep chatting). */
export async function sendHumanOffer(svc: Svc, contact: WaContact, body: string, opts: SendOptions = {}): Promise<SendOutcome> {
  return sendInteractive(
    svc,
    contact,
    body,
    [
      { id: WA_BUTTON.human, title: "Talk to a human" },
      { id: WA_BUTTON.broker, title: "My broker" },
      { id: WA_BUTTON.continue, title: "Keep chatting" },
    ],
    opts,
  );
}

// ---------------------------------------------------------------------------
// Notification channel (called from server/notify.ts)
// ---------------------------------------------------------------------------
export interface WhatsAppNotification {
  to: string;
  userId: string;
  name?: string | null;
  kind: string;
  title: string;
  body: string | null;
  /** Absolute link. */
  link: string | null;
  data: Record<string, unknown>;
}

const ACCEPT_TOKEN_RE = /\/accept\/([a-f0-9]{32,64})/i;

/** Derive the positional parameters of a template from a notification (data keys first, then the title/body). */
function paramsForTemplate(name: WaTemplateName, n: WhatsAppNotification): { values: Record<string, unknown>; buttons?: { index: number; payload: string }[] } | null {
  const d = n.data;
  const s = (k: string) => (typeof d[k] === "string" || typeof d[k] === "number" ? String(d[k]) : null);
  const link = n.link ?? "";
  const who = n.name ?? "there";
  switch (name) {
    case "broker_new_offer": {
      const token = ACCEPT_TOKEN_RE.exec(s("accept_url") ?? link)?.[1];
      if (!token) return null;
      const category = /^New (.+?) request/i.exec(n.title)?.[1] ?? "insurance";
      const reference = s("reference") ?? /request (\S+)/i.exec(n.title)?.[1] ?? "";
      const minutes = s("minutes") ?? /within (\d+) min/i.exec(n.title)?.[1] ?? (s("responds_by") ? String(Math.max(1, Math.round((Date.parse(s("responds_by")!) - Date.now()) / 60_000))) : "30");
      return { values: { category, reference, minutes, link: s("accept_url") ?? link }, buttons: [{ index: 0, payload: `${WA_BUTTON.accept}${token}` }, { index: 1, payload: `${WA_BUTTON.decline}${token}` }] };
    }
    case "renewal_reminder": {
      const category = s("category") ?? /^(.+?) cover ends/i.exec(n.title)?.[1] ?? "insurance";
      const reference = s("reference") ?? /Policy (\S+) ends/i.exec(n.body ?? "")?.[1] ?? "";
      const expiry = s("expiry_date") ?? s("cover_end") ?? /ends on (\d{4}-\d{2}-\d{2})/i.exec(n.body ?? "")?.[1] ?? "";
      return { values: { name: who, category: category.toLowerCase(), reference, expiry_date: expiry, link } };
    }
    case "policy_documents_ready":
      return { values: { name: who, reference: s("reference") ?? s("policy_number") ?? n.title, insurer: s("insurer") ?? s("insurer_name") ?? "the insurer", link } };
    case "claim_status_update":
      return { values: { name: who, reference: s("reference") ?? s("claim_reference") ?? n.title, status: s("status") ?? n.title, note: n.body ?? "", link } };
    case "quote_ready":
      return { values: { name: who, category: s("category") ?? "insurance", reference: s("reference") ?? n.title, link } };
    case "payment_link":
      return { values: { name: who, category: s("category") ?? "insurance", reference: s("reference") ?? n.title, amount: s("amount") ?? "the premium shown", link } };
    case "info_request":
      return { values: { name: who, broker: s("broker") ?? s("broker_name") ?? "Your broker", reference: s("reference") ?? n.title, what: n.body ?? n.title, link } };
    default:
      return null;
  }
}

/**
 * The `whatsapp` channel of `notify()`. Uses the registered template when the notification
 * names one (`data.template` + `data.template_params`) or when its kind maps to one;
 * otherwise falls back to the Phase 1 generic template. Returns the Phase 1 result shape
 * so the SMS fallback logic in notify() keeps working. Logs the message in wa_messages.
 */
export async function sendNotificationWhatsApp(n: WhatsAppNotification): Promise<WhatsAppSendResult & { messageId?: string | null; reason?: SendOutcome["reason"] }> {
  const svc = svcOrNull();
  if (!svc) return sendWhatsApp({ to: n.to, kind: n.kind, title: n.title, body: n.body, link: n.link });
  const contact = await ensureContact(svc, n.to, { userId: n.userId });
  if (!contact) return { ok: false, provider: whatsAppProvider().name, error: "invalid_number" };
  if (contact.opted_out_at) return { ok: false, provider: whatsAppProvider().name, error: "opted_out", reason: "opted_out" };

  const explicit = typeof n.data.template === "string" ? n.data.template : null;
  let outcome: SendOutcome | null = null;
  let templateName: string | undefined;
  if (explicit) {
    templateName = explicit;
    const values = (n.data.template_params ?? n.data) as Record<string, unknown> | unknown[];
    outcome = await sendTemplate(svc, contact, explicit, values, { sender: "system" });
  } else {
    const mapped = templateForNotificationKind(n.kind);
    const derived = mapped ? paramsForTemplate(mapped, n) : null;
    if (mapped && derived) {
      templateName = mapped;
      outcome = await sendTemplate(svc, contact, mapped, derived.values, { sender: "system", buttons: derived.buttons });
    }
  }
  if (outcome && (outcome.ok || outcome.reason !== "template_not_approved")) {
    return { ok: outcome.ok, provider: outcome.provider ?? whatsAppProvider().name, id: outcome.waMessageId ?? undefined, error: outcome.error, template: templateName, messageId: outcome.messageId, reason: outcome.reason };
  }
  // Generic Phase 1 template (title / body / link), logged like everything else.
  const conversation = await openConversation(svc, contact.id);
  const r = await sendWhatsApp({ to: contact.phone, kind: n.kind, title: n.title, body: n.body, link: n.link });
  if (conversation) {
    await svc.from("wa_messages").insert({
      conversation_id: conversation.id,
      direction: "out",
      kind: "template",
      body: [n.title, n.body ?? "", n.link ?? ""].filter(Boolean).join("\n"),
      payload: { kind: n.kind, title: n.title, body: n.body, link: n.link } as Json,
      template_name: r.template ?? null,
      status: r.ok ? "sent" : "failed",
      wa_message_id: r.ok ? (r.id ?? null) : null,
      error: r.ok ? null : (r.error ?? "send failed"),
      sender_party: "system",
    });
  }
  return r;
}
