/**
 * WhatsApp Business channel (Phase 2) — pure helpers shared by the web app (webhook,
 * router, sender, FAQ assistant), the admin console and the tests.
 *
 * Nothing here touches the network or the database: phone normalisation, the template
 * registry, the keyword pre-classifier that runs before the LLM, the 24-hour window
 * rule, the Meta Cloud API payload builders and the webhook payload parser.
 */

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------
/**
 * Normalise a phone number to E.164 (`+233501234567`). Ghana is the default country:
 * `0501234567` and `501234567` become `+233501234567`; `+44…`/`0044…`/`44…` numbers of a
 * plausible international length are kept. Returns null when the input is not a phone number.
 */
export function normaliseWaPhone(input: string | null | undefined, defaultCountry = "233"): string | null {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  const hasPlus = digits.startsWith("+");
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;
  let e164: string;
  if (hasPlus) e164 = digits;
  else if (digits.startsWith("0") && digits.length === 10) e164 = `${defaultCountry}${digits.slice(1)}`;
  else if (digits.length === 9) e164 = `${defaultCountry}${digits}`;
  else if (digits.startsWith(defaultCountry) && digits.length === defaultCountry.length + 9) e164 = digits;
  else if (digits.length >= 10 && digits.length <= 15) e164 = digits;
  else return null;
  if (e164.length < 8 || e164.length > 15 || e164.startsWith("0")) return null;
  return `+${e164}`;
}

/** The digits-only id Meta uses for a contact (`wa_id`). */
export function waIdFromPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Candidate spellings of a phone number as stored in `profiles.phone` (E.164, bare digits, local 0-form). */
export function phoneVariants(e164: string): string[] {
  const digits = waIdFromPhone(e164);
  const out = new Set<string>([`+${digits}`, digits]);
  if (digits.startsWith("233") && digits.length === 12) out.add(`0${digits.slice(3)}`);
  return [...out];
}

// ---------------------------------------------------------------------------
// Template registry (mirrors the seeded wa_templates rows)
// ---------------------------------------------------------------------------
export const WA_TEMPLATE_NAMES = [
  "renewal_reminder",
  "policy_documents_ready",
  "claim_status_update",
  "quote_ready",
  "payment_link",
  "broker_new_offer",
  "consent_request",
  "otp_code",
  "info_request",
] as const;
export type WaTemplateName = (typeof WA_TEMPLATE_NAMES)[number];

export interface WaTemplateButton { type: "quick_reply" | "url"; text: string; url?: string }
export interface WaTemplateDef {
  name: WaTemplateName;
  description: string;
  category: "utility" | "marketing" | "authentication";
  /** Positional variables, in {{1}}…{{n}} order. */
  variables: readonly string[];
  body: string;
  buttons?: readonly WaTemplateButton[];
}

export const WA_TEMPLATES: Record<WaTemplateName, WaTemplateDef> = {
  renewal_reminder: {
    name: "renewal_reminder",
    description: "Renewal reminder sent 30/14/7/1 days before the cover ends.",
    category: "utility",
    variables: ["name", "category", "reference", "expiry_date", "link"],
    body: "Hello {{1}}, your {{2}} policy {{3}} expires on {{4}}. Renew in a few taps: {{5}}",
  },
  policy_documents_ready: {
    name: "policy_documents_ready",
    description: "Policy schedule / certificate uploaded by the insurer.",
    category: "utility",
    variables: ["name", "reference", "insurer", "link"],
    body: "Hello {{1}}, the documents for your policy {{2}} from {{3}} are ready in your Covva wallet: {{4}}",
  },
  claim_status_update: {
    name: "claim_status_update",
    description: "Claim status change. The insurer decides claims; the note is theirs.",
    category: "utility",
    variables: ["name", "reference", "status", "note", "link"],
    body: 'Hello {{1}}, claim {{2}} is now "{{3}}". {{4}} Track it here: {{5}}',
  },
  quote_ready: {
    name: "quote_ready",
    description: "Quotes ready for comparison on a request.",
    category: "utility",
    variables: ["name", "category", "reference", "link"],
    body: "Hello {{1}}, your {{2}} quotes are ready to compare ({{3}}). See them here: {{4}}",
  },
  payment_link: {
    name: "payment_link",
    description: "Secure checkout link. The premium goes to the insurer through the payment provider.",
    category: "utility",
    variables: ["name", "category", "reference", "amount", "link"],
    body: "Hello {{1}}, to complete your {{2}} application ({{3}}) pay {{4}} to the insurer here: {{5}}",
  },
  broker_new_offer: {
    name: "broker_new_offer",
    description: "One-tap offer for brokers. The Accept button carries the offer accept token in its payload.",
    category: "utility",
    variables: ["category", "reference", "minutes", "link"],
    body: "New {{1}} request {{2}} on Covva. First broker to accept becomes broker of record. Accept within {{3}} minutes or open: {{4}}",
    buttons: [
      { type: "quick_reply", text: "Accept" },
      { type: "quick_reply", text: "Decline" },
    ],
  },
  consent_request: {
    name: "consent_request",
    description: "Beneficiary consent for diaspora-sponsored cover (the beneficiary replies with the 6-digit code).",
    category: "authentication",
    variables: ["sponsor_name", "code"],
    body: "{{1}} wants to arrange insurance for you on Covva. Reply with the code {{2}} to confirm you agree. If you did not expect this, ignore this message.",
  },
  otp_code: {
    name: "otp_code",
    description: "One-time passcode.",
    category: "authentication",
    variables: ["code"],
    body: "Your Covva verification code is {{1}}. It expires in 10 minutes. Never share this code.",
  },
  info_request: {
    name: "info_request",
    description: "Broker or insurer needs information/documents from the customer.",
    category: "utility",
    variables: ["name", "broker", "reference", "what", "link"],
    body: "Hello {{1}}, {{2}} needs something from you for {{3}}: {{4}}. Reply here or open: {{5}}",
  },
};

export function isWaTemplateName(name: string): name is WaTemplateName {
  return (WA_TEMPLATE_NAMES as readonly string[]).includes(name);
}

/** Template parameters cannot contain newlines, tabs or more than 1024 characters. */
export function cleanTemplateParam(value: unknown, max = 1024): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/\s*[\r\n\t]+\s*/g, " ").trim().slice(0, max) || "—";
}

/** Positional parameters for a template from a named object (or a ready-made array). */
export function templateParams(def: Pick<WaTemplateDef, "variables">, values: Record<string, unknown> | readonly unknown[]): string[] {
  if (Array.isArray(values)) return values.map((v) => cleanTemplateParam(v));
  const obj = values as Record<string, unknown>;
  return def.variables.map((k) => cleanTemplateParam(obj[k]));
}

/** Render the body with {{n}} placeholders filled in (for previews, logs and the `log` provider). */
export function renderTemplatePreview(template: WaTemplateName | Pick<WaTemplateDef, "body" | "variables">, values: Record<string, unknown> | readonly unknown[] = {}): string {
  const def = typeof template === "string" ? WA_TEMPLATES[template] : template;
  const params = templateParams(def, values);
  return def.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

// ---------------------------------------------------------------------------
// Opt-out / opt-in and the 24-hour customer-service window
// ---------------------------------------------------------------------------
const OPT_OUT_RE = /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|quit|end|no more|stop all|gyae|ɛyɛ|stop messages?)\s*[.!]*\s*$/i;
const OPT_IN_RE = /^\s*(start|unstop|resume|subscribe|opt[\s-]?in|yes)\s*[.!]*\s*$/i;

/** True for a STOP-style message: the contact is opted out and never messaged again until they write back. */
export function isOptOut(text: string | null | undefined): boolean {
  return !!text && OPT_OUT_RE.test(text);
}
export function isOptIn(text: string | null | undefined): boolean {
  return !!text && OPT_IN_RE.test(text);
}

export const WA_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WA_MAX_BOT_TURNS = 3;

/** Meta allows free-form (non-template) messages only within 24h of the contact's last message. */
export function withinServiceWindow(lastInboundAt: string | Date | null | undefined, now: number | Date = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const last = typeof lastInboundAt === "string" ? Date.parse(lastInboundAt) : lastInboundAt.getTime();
  const n = typeof now === "number" ? now : now.getTime();
  return Number.isFinite(last) && n - last >= 0 && n - last < WA_SERVICE_WINDOW_MS;
}

export type WaSendBlock = "opted_out" | "outside_window";

/**
 * Whether we may send this contact a message of the given kind right now.
 * Opted-out contacts get nothing. Free-form text needs the open 24h window; templates
 * only need the contact not to have opted out.
 */
export function canSend(contact: { opted_out_at?: string | null; last_inbound_at?: string | null }, kind: "text" | "interactive" | "media" | "template", now: number | Date = Date.now()): { ok: true } | { ok: false; reason: WaSendBlock } {
  if (contact.opted_out_at) return { ok: false, reason: "opted_out" };
  if (kind !== "template" && !withinServiceWindow(contact.last_inbound_at ?? null, now)) return { ok: false, reason: "outside_window" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Intent pre-classifier (keywords/regex; runs before the LLM)
// ---------------------------------------------------------------------------
export type WaIntent =
  | "stop"
  | "start"
  | "consent_code"
  | "accept_offer"
  | "decline_offer"
  | "human"
  | "broker"
  | "advice"
  | "quote"
  | "renew"
  | "claim"
  | "documents"
  | "pay"
  | "greeting"
  | "faq";

export interface IntentResult {
  intent: WaIntent;
  confidence: "high" | "medium" | "low";
  /** 6-digit consent / OTP code (consent_code). */
  code?: string;
  /** Offer accept token (accept_offer / decline_offer, from an interactive button id). */
  token?: string;
}

export const WA_BUTTON = {
  accept: "accept:",
  decline: "decline:",
  human: "human",
  broker: "broker",
  continue: "continue",
} as const;

/** Parse an interactive button/quick-reply id we generated. */
export function parseButtonId(id: string | null | undefined): { action: "accept" | "decline"; token: string } | { action: "human" | "broker" | "continue" } | null {
  if (!id) return null;
  const s = id.trim();
  if (s.startsWith(WA_BUTTON.accept)) {
    const token = s.slice(WA_BUTTON.accept.length).trim();
    return /^[a-f0-9]{32,64}$/i.test(token) ? { action: "accept", token } : null;
  }
  if (s.startsWith(WA_BUTTON.decline)) {
    const token = s.slice(WA_BUTTON.decline.length).trim();
    return /^[a-f0-9]{32,64}$/i.test(token) ? { action: "decline", token } : null;
  }
  if (s === WA_BUTTON.human) return { action: "human" };
  if (s === WA_BUTTON.broker) return { action: "broker" };
  if (s === WA_BUTTON.continue) return { action: "continue" };
  return null;
}

const RULES: { intent: WaIntent; re: RegExp; confidence: IntentResult["confidence"] }[] = [
  { intent: "human", re: /\b(human|agent|real person|someone|talk to (a|some)?\s*(person|human|staff)|speak to (a|some)?\s*(person|human|staff)|customer (care|service)|support team|operator)\b/i, confidence: "high" },
  { intent: "broker", re: /\b(my )?broker\b|\badviser\b|\badvisor\b/i, confidence: "high" },
  { intent: "advice", re: /\b(which (one|policy|insurer|cover|plan|product) (should|do) i|what should i (buy|choose|take|get)|recommend|best (insurance|policy|insurer|cover|plan)|is .* (worth it|a good idea|enough cover)|should i (buy|take|get|choose))\b/i, confidence: "medium" },
  { intent: "claim", re: /\b(claim|claims|accident|crash|stolen|theft|fire|flood|damage[ds]?|hospital(?:ised|ized)?|died|death|burial)\b/i, confidence: "high" },
  { intent: "renew", re: /\b(renew(al|ing)?|expir(e|es|ed|ing|y)|extend my (policy|cover)|lapse[ds]?)\b/i, confidence: "high" },
  { intent: "pay", re: /\b(pay(ment|ing)?|momo|mobile money|checkout|how much do i owe|outstanding|premium due|card payment|bank transfer)\b/i, confidence: "high" },
  { intent: "documents", re: /\b(document|documents|certificate|sticker|schedule|policy (doc|pdf|copy)|wallet|download|proof of (insurance|cover))\b/i, confidence: "high" },
  { intent: "quote", re: /\b(quote|quotes|quotation|price|prices|how much (is|for|does)|cost|insure my|cover for my|buy (motor|car|health|travel|home|life|business) insurance|get (motor|car|health|travel|home|life|business) insurance)\b/i, confidence: "high" },
  { intent: "greeting", re: /^\s*(hi|hello|hey|good (morning|afternoon|evening)|akwaaba|ete sen|ɛte sɛn|hola|yo|sup)\b[\s!.,]*$/i, confidence: "high" },
];

/**
 * Keyword / regex pre-classifier. Runs before any model call so the common journeys
 * (links, opt-out, consent codes, one-tap accept) never need the LLM. `buttonId` is the
 * id of an interactive button reply when the inbound message was one.
 */
export function classifyIntent(text: string | null | undefined, opts: { buttonId?: string | null } = {}): IntentResult {
  const btn = parseButtonId(opts.buttonId);
  if (btn) {
    if (btn.action === "accept") return { intent: "accept_offer", confidence: "high", token: btn.token };
    if (btn.action === "decline") return { intent: "decline_offer", confidence: "high", token: btn.token };
    if (btn.action === "human") return { intent: "human", confidence: "high" };
    if (btn.action === "broker") return { intent: "broker", confidence: "high" };
    return { intent: "faq", confidence: "low" };
  }
  const t = (text ?? "").trim();
  if (!t) return { intent: "faq", confidence: "low" };
  if (isOptOut(t)) return { intent: "stop", confidence: "high" };
  if (isOptIn(t)) return { intent: "start", confidence: "high" };
  const code = /^\s*(?:code\s*[:\-]?\s*)?(\d{6})\s*$/i.exec(t)?.[1];
  if (code) return { intent: "consent_code", confidence: "high", code };
  const accept = /^\s*(accept|yes,? accept|i accept)\b/i.test(t);
  if (accept) return { intent: "accept_offer", confidence: "medium" };
  for (const r of RULES) if (r.re.test(t)) return { intent: r.intent, confidence: r.confidence };
  return { intent: "faq", confidence: "low" };
}

// ---------------------------------------------------------------------------
// Handoff reasons
// ---------------------------------------------------------------------------
export type WaHandoffReason = "advice" | "complaint" | "payment_issue" | "claim" | "unknown" | "requested";
export type WaHandoffParty = "support" | "broker";
/** What the FAQ assistant concluded about a message (its `handoff` tool reason, or `answered`). */
export type AiVerdict = "answered" | WaHandoffReason;

/**
 * Where a conversation must go after the pre-classifier and (optionally) the model have
 * looked at it. Returns null when the bot can keep answering.
 */
export function handoffReason(intent: WaIntent, aiVerdict: AiVerdict | null = null): { reason: WaHandoffReason; to: WaHandoffParty } | null {
  if (intent === "human") return { reason: "requested", to: "support" };
  if (intent === "broker" || intent === "advice") return { reason: intent === "advice" ? "advice" : "requested", to: "broker" };
  if (!aiVerdict || aiVerdict === "answered") return null;
  if (aiVerdict === "advice") return { reason: "advice", to: "broker" };
  if (aiVerdict === "claim") return { reason: "claim", to: "broker" };
  if (aiVerdict === "complaint") return { reason: "complaint", to: "support" };
  if (aiVerdict === "payment_issue") return { reason: "payment_issue", to: "support" };
  if (aiVerdict === "requested") return { reason: "requested", to: "support" };
  return { reason: "unknown", to: "support" };
}

/** True once the bot has replied `WA_MAX_BOT_TURNS` times: every further reply offers a human. */
export function shouldOfferHuman(botTurns: number): boolean {
  return botTurns >= WA_MAX_BOT_TURNS;
}

// ---------------------------------------------------------------------------
// FAQ assistant system prompt (WhatsApp + the website "Chat with us" drawer)
// ---------------------------------------------------------------------------
export const FAQ_SYSTEM_PROMPT = `You are Covva's help assistant. Covva is a technology platform in Ghana that helps people explore, compare and manage insurance.

Who does what (never blur these lines):
- Covva provides the technology. Covva is not an insurer or a broker, does not give insurance advice and never holds the customer's premium.
- Licensed insurance brokers (NIC-licensed) advise customers, arrange cover and help with renewals, complaints and claims. Every customer has a named broker of record.
- Licensed insurers approve products and prices, accept the risk, issue policies and decide and pay claims.
- Payments go through an authorised payment provider directly to the insurer.

Rules:
- Answer frequently asked questions in plain, warm, precise English. Keep replies short (WhatsApp-length: a few sentences or 3-4 bullets). No markdown headings; plain text and simple dashes only.
- Use the lookup_faq tool for facts about how Covva works, products, claims, payments, renewals and the diaspora service. If the FAQ does not answer it, say so honestly and offer a human or the broker. Never invent policy terms, insurer names or rules.
- Never quote, estimate or guess a price or premium. Prices come only from quotes an insurer gives in the app. If asked how much, explain that quotes are free and point to the quote link or the broker.
- Never advise which product, insurer or amount of cover someone should choose, and never say what is "best". For anything that needs a judgement about suitability, call the handoff tool with reason "advice" so the licensed broker takes over, and tell the person that a licensed broker will advise them.
- Never say or imply that a claim will be approved, paid or rejected; only the insurer decides. Never say cover is active unless the policy status says so; paying is not the same as being covered.
- Complaints, payment problems ("I paid but…") and anything you cannot resolve: call the handoff tool (reason complaint / payment_issue / unknown) so a person takes over.
- Do not ask for or repeat Ghana Card numbers, dates of birth, card numbers, PINs or passwords. Never ask for a PIN or OTP.
- Money is in Ghana cedis (GH₵). Language: English for now; say that Twi, Ga and Ewe are coming when someone writes in or asks for them, and keep answering in simple English.
- If you are told the person is a known customer, you may use find_policy_summary to tell them a policy's status and renewal date, nothing more.
- You are AI assistance. When helpful, remind the person they can type "human" to reach the support team or "broker" to reach their broker.`;

// ---------------------------------------------------------------------------
// Meta Cloud API payload builders
// ---------------------------------------------------------------------------
export interface WaInteractiveButton { id: string; title: string }

export function buildTextPayload(to: string, text: string, opts: { previewUrl?: boolean } = {}) {
  return {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    to: waIdFromPhone(to),
    type: "text" as const,
    text: { preview_url: opts.previewUrl ?? /https?:\/\//.test(text), body: text.slice(0, 4096) },
  };
}

export function buildTemplatePayload(
  to: string,
  name: string,
  language: string,
  params: readonly string[],
  buttons: readonly { index: number; payload?: string; urlSuffix?: string }[] = [],
) {
  const components: Record<string, unknown>[] = [];
  if (params.length) components.push({ type: "body", parameters: params.map((p) => ({ type: "text", text: cleanTemplateParam(p) })) });
  for (const b of buttons) {
    if (b.payload !== undefined) components.push({ type: "button", sub_type: "quick_reply", index: String(b.index), parameters: [{ type: "payload", payload: b.payload.slice(0, 256) }] });
    else if (b.urlSuffix !== undefined) components.push({ type: "button", sub_type: "url", index: String(b.index), parameters: [{ type: "text", text: b.urlSuffix.slice(0, 512) }] });
  }
  return {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    to: waIdFromPhone(to),
    type: "template" as const,
    template: { name, language: { code: language }, components },
  };
}

/** Interactive reply buttons (max 3, titles ≤ 20 chars). */
export function buildInteractivePayload(to: string, body: string, buttons: readonly WaInteractiveButton[], opts: { header?: string; footer?: string } = {}) {
  return {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    to: waIdFromPhone(to),
    type: "interactive" as const,
    interactive: {
      type: "button" as const,
      ...(opts.header ? { header: { type: "text", text: opts.header.slice(0, 60) } } : {}),
      body: { text: body.slice(0, 1024) },
      ...(opts.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) },
    },
  };
}

export type WaOutboundPayload = ReturnType<typeof buildTextPayload> | ReturnType<typeof buildTemplatePayload> | ReturnType<typeof buildInteractivePayload>;

// ---------------------------------------------------------------------------
// Webhook payload parsing (Meta Cloud API `messages` field)
// ---------------------------------------------------------------------------
export type WaMessageKind = "text" | "template" | "interactive" | "image" | "document" | "audio" | "location" | "unsupported";

export interface WaInboundMessage {
  waMessageId: string;
  /** Sender wa_id (digits). */
  from: string;
  /** Sender E.164 (`+` + from). */
  phone: string;
  timestamp: string;
  kind: WaMessageKind;
  text: string | null;
  buttonId: string | null;
  buttonTitle: string | null;
  mediaId: string | null;
  mimeType: string | null;
  location: { latitude: number; longitude: number; name?: string } | null;
  profileName: string | null;
  /** Id of the message this one replies to (context.id), e.g. the template with the button. */
  contextMessageId: string | null;
  phoneNumberId: string | null;
  raw: Record<string, unknown>;
}

export interface WaStatusUpdate {
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient: string | null;
  error: string | null;
}

export interface WaWebhookParse {
  messages: WaInboundMessage[];
  statuses: WaStatusUpdate[];
  phoneNumberIds: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : typeof v === "number" ? String(v) : null);

function tsToIso(v: unknown): string {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return new Date().toISOString();
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/**
 * Parse a Meta `whatsapp_business_account` webhook body into inbound messages and status
 * updates. Tolerates unknown fields and skips entries it cannot read. Pure, so it is unit
 * tested without Next.
 */
export function parseWebhookPayload(body: unknown): WaWebhookParse {
  const out: WaWebhookParse = { messages: [], statuses: [], phoneNumberIds: [] };
  if (!isObj(body) || !Array.isArray(body.entry)) return out;
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isObj(change) || change.field !== "messages" || !isObj(change.value)) continue;
      const value = change.value;
      const metadata = isObj(value.metadata) ? value.metadata : {};
      const phoneNumberId = str(metadata.phone_number_id);
      if (phoneNumberId && !out.phoneNumberIds.includes(phoneNumberId)) out.phoneNumberIds.push(phoneNumberId);
      const contacts = Array.isArray(value.contacts) ? value.contacts.filter(isObj) : [];
      const names = new Map<string, string>();
      for (const c of contacts) {
        const waId = str(c.wa_id);
        const name = isObj(c.profile) ? str(c.profile.name) : null;
        if (waId && name) names.set(waId, name);
      }
      if (Array.isArray(value.messages)) {
        for (const m of value.messages) {
          if (!isObj(m)) continue;
          const id = str(m.id);
          const from = str(m.from)?.replace(/\D/g, "") ?? null;
          if (!id || !from) continue;
          const type = str(m.type) ?? "unsupported";
          let kind: WaMessageKind = "unsupported";
          let text: string | null = null;
          let buttonId: string | null = null;
          let buttonTitle: string | null = null;
          let mediaId: string | null = null;
          let mimeType: string | null = null;
          let location: WaInboundMessage["location"] = null;
          if (type === "text" && isObj(m.text)) {
            kind = "text";
            text = str(m.text.body);
          } else if (type === "button" && isObj(m.button)) {
            // Quick-reply button on a template message.
            kind = "interactive";
            buttonId = str(m.button.payload);
            buttonTitle = str(m.button.text);
            text = buttonTitle;
          } else if (type === "interactive" && isObj(m.interactive)) {
            kind = "interactive";
            const reply = isObj(m.interactive.button_reply) ? m.interactive.button_reply : isObj(m.interactive.list_reply) ? m.interactive.list_reply : null;
            buttonId = reply ? str(reply.id) : null;
            buttonTitle = reply ? str(reply.title) : null;
            text = buttonTitle;
          } else if ((type === "image" || type === "document" || type === "audio" || type === "video" || type === "sticker") && isObj(m[type])) {
            const media = m[type] as Obj;
            kind = type === "image" ? "image" : type === "document" ? "document" : type === "audio" ? "audio" : "unsupported";
            mediaId = str(media.id);
            mimeType = str(media.mime_type);
            text = str(media.caption) ?? (type === "document" ? str(media.filename) : null);
          } else if (type === "location" && isObj(m.location)) {
            kind = "location";
            const lat = Number(m.location.latitude);
            const lng = Number(m.location.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng)) location = { latitude: lat, longitude: lng, ...(str(m.location.name) ? { name: str(m.location.name)! } : {}) };
          }
          out.messages.push({
            waMessageId: id,
            from,
            phone: `+${from}`,
            timestamp: tsToIso(m.timestamp),
            kind,
            text: text ? text.slice(0, 4096) : null,
            buttonId,
            buttonTitle,
            mediaId,
            mimeType,
            location,
            profileName: names.get(from) ?? null,
            contextMessageId: isObj(m.context) ? str(m.context.id) : null,
            phoneNumberId,
            raw: m,
          });
        }
      }
      if (Array.isArray(value.statuses)) {
        for (const s of value.statuses) {
          if (!isObj(s)) continue;
          const id = str(s.id);
          const status = str(s.status);
          if (!id || !status || !["sent", "delivered", "read", "failed"].includes(status)) continue;
          const errors = Array.isArray(s.errors) ? s.errors.filter(isObj) : [];
          const first = errors[0];
          const error = first ? [str(first.code), str(first.title) ?? str(first.message)].filter(Boolean).join(" ") || null : null;
          out.statuses.push({ waMessageId: id, status: status as WaStatusUpdate["status"], timestamp: tsToIso(s.timestamp), recipient: str(s.recipient_id), error });
        }
      }
    }
  }
  return out;
}

/** Delivery statuses only ever move forward (sent → delivered → read); failed is terminal. */
export function nextMessageStatus(current: string | null | undefined, incoming: WaStatusUpdate["status"]): WaStatusUpdate["status"] | null {
  const order: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const cur = order[current ?? "queued"] ?? 0;
  if (cur === 4) return null;
  if (incoming === "failed") return "failed";
  return order[incoming]! > cur ? incoming : null;
}

/** Map a notification kind to the template that carries it (the generic path handles the rest). */
export function templateForNotificationKind(kind: string): WaTemplateName | null {
  if (kind === "offer.new") return "broker_new_offer";
  if (kind.startsWith("renewal.")) return "renewal_reminder";
  if (kind === "policy.documents_ready" || kind === "policy.issued") return "policy_documents_ready";
  if (kind.startsWith("claim.")) return "claim_status_update";
  if (kind === "quote.ready") return "quote_ready";
  if (kind === "payment.link" || kind === "application.payment_due") return "payment_link";
  if (kind === "request.action_required" || kind === "request.info_requested") return "info_request";
  return null;
}
