import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WA_MAX_BOT_TURNS,
  WA_TEMPLATES,
  WA_TEMPLATE_NAMES,
  buildInteractivePayload,
  buildTemplatePayload,
  buildTextPayload,
  canSend,
  classifyIntent,
  handoffReason,
  isOptIn,
  isOptOut,
  nextMessageStatus,
  normaliseWaPhone,
  parseButtonId,
  parseWebhookPayload,
  phoneVariants,
  renderTemplatePreview,
  shouldOfferHuman,
  templateForNotificationKind,
  templateParams,
  waIdFromPhone,
  withinServiceWindow,
} from "./whatsapp.ts";

test("normaliseWaPhone returns E.164 with Ghana as the default country", () => {
  assert.equal(normaliseWaPhone("0501234567"), "+233501234567");
  assert.equal(normaliseWaPhone("050 123 4567"), "+233501234567");
  assert.equal(normaliseWaPhone("501234567"), "+233501234567");
  assert.equal(normaliseWaPhone("233501234567"), "+233501234567");
  assert.equal(normaliseWaPhone("+233 50 123 4567"), "+233501234567");
  assert.equal(normaliseWaPhone("+44 7700 900123"), "+447700900123");
  assert.equal(normaliseWaPhone("0044 7700 900123"), "+447700900123");
  assert.equal(normaliseWaPhone("12125551234"), "+12125551234");
  assert.equal(normaliseWaPhone(""), null);
  assert.equal(normaliseWaPhone("hello"), null);
  assert.equal(normaliseWaPhone("123"), null);
  assert.equal(waIdFromPhone("+233501234567"), "233501234567");
  assert.deepEqual(phoneVariants("+233501234567"), ["+233501234567", "233501234567", "0501234567"]);
});

test("template registry: every seeded template has ordered variables matching its placeholders", () => {
  assert.deepEqual([...WA_TEMPLATE_NAMES].sort(), ["broker_new_offer", "claim_status_update", "consent_request", "info_request", "otp_code", "payment_link", "policy_documents_ready", "quote_ready", "renewal_reminder"]);
  for (const name of WA_TEMPLATE_NAMES) {
    const t = WA_TEMPLATES[name];
    const placeholders = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    assert.deepEqual(placeholders, t.variables.map((_, i) => i + 1), `${name} placeholders are 1..n in order`);
    assert.ok(t.description.length > 10, `${name} has a description`);
  }
  assert.equal(WA_TEMPLATES.broker_new_offer.buttons?.[0]?.text, "Accept");
});

test("renderTemplatePreview fills placeholders from names or positions and strips newlines", () => {
  const out = renderTemplatePreview("renewal_reminder", { name: "Ama", category: "motor", reference: "POL-1", expiry_date: "12 Nov 2026", link: "https://covva.com.gh/r/1" });
  assert.equal(out, "Hello Ama, your motor policy POL-1 expires on 12 Nov 2026. Renew in a few taps: https://covva.com.gh/r/1");
  assert.equal(renderTemplatePreview("otp_code", ["123456"]), "Your Covva verification code is 123456. It expires in 10 minutes. Never share this code.");
  assert.deepEqual(templateParams(WA_TEMPLATES.otp_code, { code: "a\nb\tc" }), ["a b c"]);
  assert.deepEqual(templateParams(WA_TEMPLATES.quote_ready, { name: "Kofi" }), ["Kofi", "—", "—", "—"]);
  assert.match(renderTemplatePreview("payment_link", {}), /Hello —/);
});

test("opt-out and opt-in keywords", () => {
  for (const s of ["STOP", "stop", " Stop. ", "unsubscribe", "opt out", "opt-out", "cancel", "No more"]) assert.equal(isOptOut(s), true, s);
  for (const s of ["stop my policy", "please don't stop", "I want to renew", ""]) assert.equal(isOptOut(s), false, s);
  assert.equal(isOptIn("START"), true);
  assert.equal(isOptIn("start a claim"), false);
  assert.equal(classifyIntent("STOP").intent, "stop");
  assert.equal(classifyIntent("start").intent, "start");
});

test("24-hour window and canSend", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  assert.equal(withinServiceWindow("2026-10-26T11:00:00Z", now), true);
  assert.equal(withinServiceWindow("2026-10-25T12:00:01Z", now), true);
  assert.equal(withinServiceWindow("2026-10-25T12:00:00Z", now), false);
  assert.equal(withinServiceWindow("2026-10-25T11:59:59Z", now), false);
  assert.equal(withinServiceWindow(null, now), false);
  assert.equal(withinServiceWindow("2026-10-27T12:00:00Z", now), false, "future timestamps are not inside the window");

  const fresh = { opted_out_at: null, last_inbound_at: "2026-10-26T11:00:00Z" };
  const stale = { opted_out_at: null, last_inbound_at: "2026-10-20T11:00:00Z" };
  const out = { opted_out_at: "2026-10-26T11:30:00Z", last_inbound_at: "2026-10-26T11:00:00Z" };
  assert.deepEqual(canSend(fresh, "text", now), { ok: true });
  assert.deepEqual(canSend(stale, "text", now), { ok: false, reason: "outside_window" });
  assert.deepEqual(canSend(stale, "interactive", now), { ok: false, reason: "outside_window" });
  assert.deepEqual(canSend(stale, "template", now), { ok: true });
  assert.deepEqual(canSend(out, "template", now), { ok: false, reason: "opted_out" });
  assert.deepEqual(canSend(out, "text", now), { ok: false, reason: "opted_out" });
});

test("classifyIntent: links and journeys before the model", () => {
  assert.equal(classifyIntent("I need a quote for my car").intent, "quote");
  assert.equal(classifyIntent("How much is health insurance?").intent, "quote");
  assert.equal(classifyIntent("my policy expires next week, how do I renew").intent, "renew");
  assert.equal(classifyIntent("I had an accident yesterday").intent, "claim");
  assert.equal(classifyIntent("where is my certificate").intent, "documents");
  assert.equal(classifyIntent("can I pay with momo").intent, "pay");
  assert.equal(classifyIntent("I want to talk to my broker").intent, "broker");
  assert.equal(classifyIntent("can I speak to a human").intent, "human");
  assert.equal(classifyIntent("which policy should I buy?").intent, "advice");
  assert.equal(classifyIntent("Hello!").intent, "greeting");
  assert.equal(classifyIntent("What is Covva?").intent, "faq");
  assert.equal(classifyIntent("").intent, "faq");
  assert.deepEqual(classifyIntent("483920"), { intent: "consent_code", confidence: "high", code: "483920" });
  assert.deepEqual(classifyIntent("Code: 483920"), { intent: "consent_code", confidence: "high", code: "483920" });
  assert.equal(classifyIntent("4839201").intent, "faq", "seven digits is not a consent code");
});

test("classifyIntent: interactive buttons carry the offer token", () => {
  const token = "a".repeat(40);
  assert.deepEqual(classifyIntent(null, { buttonId: `accept:${token}` }), { intent: "accept_offer", confidence: "high", token });
  assert.deepEqual(classifyIntent("Decline", { buttonId: `decline:${token}` }), { intent: "decline_offer", confidence: "high", token });
  assert.equal(classifyIntent("Talk to a human", { buttonId: "human" }).intent, "human");
  assert.equal(classifyIntent("My broker", { buttonId: "broker" }).intent, "broker");
  assert.equal(parseButtonId("accept:not-a-token"), null);
  assert.equal(parseButtonId("rubbish"), null);
  assert.equal(classifyIntent("Accept").intent, "accept_offer");
  assert.equal(classifyIntent("Accept").token, undefined);
});

test("handoffReason combines the classifier and the model verdict", () => {
  assert.deepEqual(handoffReason("human"), { reason: "requested", to: "support" });
  assert.deepEqual(handoffReason("broker"), { reason: "requested", to: "broker" });
  assert.deepEqual(handoffReason("advice"), { reason: "advice", to: "broker" });
  assert.equal(handoffReason("faq"), null);
  assert.equal(handoffReason("faq", "answered"), null);
  assert.deepEqual(handoffReason("faq", "advice"), { reason: "advice", to: "broker" });
  assert.deepEqual(handoffReason("faq", "complaint"), { reason: "complaint", to: "support" });
  assert.deepEqual(handoffReason("faq", "payment_issue"), { reason: "payment_issue", to: "support" });
  assert.deepEqual(handoffReason("claim", "claim"), { reason: "claim", to: "broker" });
  assert.deepEqual(handoffReason("faq", "unknown"), { reason: "unknown", to: "support" });
  assert.equal(WA_MAX_BOT_TURNS, 3);
  assert.equal(shouldOfferHuman(2), false);
  assert.equal(shouldOfferHuman(3), true);
});

test("payload builders match the Cloud API shapes", () => {
  const text = buildTextPayload("+233501234567", "Hello https://covva.com.gh");
  assert.equal(text.to, "233501234567");
  assert.equal(text.type, "text");
  assert.equal(text.text.preview_url, true);

  const token = "b".repeat(40);
  const tpl = buildTemplatePayload("+233501234567", "broker_new_offer", "en", ["motor", "REQ-1", "30", "https://x"], [{ index: 0, payload: `accept:${token}` }, { index: 1, payload: `decline:${token}` }]);
  assert.equal(tpl.template.name, "broker_new_offer");
  assert.equal(tpl.template.language.code, "en");
  assert.equal(tpl.template.components.length, 3);
  assert.deepEqual(tpl.template.components[0], { type: "body", parameters: [{ type: "text", text: "motor" }, { type: "text", text: "REQ-1" }, { type: "text", text: "30" }, { type: "text", text: "https://x" }] });
  assert.deepEqual(tpl.template.components[1], { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `accept:${token}` }] });

  const inter = buildInteractivePayload("+233501234567", "Need more help?", [{ id: "human", title: "Talk to a human" }, { id: "broker", title: "My broker" }, { id: "continue", title: "Keep chatting" }, { id: "x", title: "dropped" }]);
  assert.equal(inter.interactive.action.buttons.length, 3, "max three buttons");
  assert.equal(inter.interactive.action.buttons[0]!.reply.id, "human");
});

test("parseWebhookPayload reads text, button replies, media, locations and statuses", () => {
  const body = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "233200000000", phone_number_id: "PNID1" },
              contacts: [{ profile: { name: "Ama Mensah" }, wa_id: "233501234567" }],
              messages: [
                { from: "233501234567", id: "wamid.1", timestamp: "1761480000", type: "text", text: { body: "I need a quote" } },
                { from: "233501234567", id: "wamid.2", timestamp: "1761480001", type: "button", button: { payload: "accept:" + "c".repeat(40), text: "Accept" }, context: { id: "wamid.tpl" } },
                { from: "233501234567", id: "wamid.3", timestamp: "1761480002", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "human", title: "Talk to a human" } } },
                { from: "233501234567", id: "wamid.4", timestamp: "1761480003", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "my car" } },
                { from: "233501234567", id: "wamid.5", timestamp: "1761480004", type: "location", location: { latitude: 5.6, longitude: -0.19, name: "Accra" } },
                { from: "233501234567", id: "wamid.6", timestamp: "1761480005", type: "sticker", sticker: { id: "S1", mime_type: "image/webp" } },
                { from: "233501234567", timestamp: "1761480006", type: "text", text: { body: "no id — skipped" } },
              ],
            },
          },
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PNID1" },
              statuses: [
                { id: "wamid.out1", status: "delivered", timestamp: "1761480010", recipient_id: "233501234567" },
                { id: "wamid.out2", status: "failed", timestamp: "1761480011", recipient_id: "233501234567", errors: [{ code: 131047, title: "Re-engagement message" }] },
                { id: "wamid.out3", status: "bogus", timestamp: "1761480012" },
              ],
            },
          },
          { field: "account_update", value: {} },
        ],
      },
    ],
  };
  const parsed = parseWebhookPayload(body);
  assert.deepEqual(parsed.phoneNumberIds, ["PNID1"]);
  assert.equal(parsed.messages.length, 6);
  const [t, b, i, img, loc, stk] = parsed.messages;
  assert.equal(t!.kind, "text");
  assert.equal(t!.text, "I need a quote");
  assert.equal(t!.phone, "+233501234567");
  assert.equal(t!.profileName, "Ama Mensah");
  assert.equal(t!.timestamp, "2025-10-26T12:00:00.000Z");
  assert.equal(b!.kind, "interactive");
  assert.equal(b!.buttonId, "accept:" + "c".repeat(40));
  assert.equal(b!.contextMessageId, "wamid.tpl");
  assert.equal(i!.buttonId, "human");
  assert.equal(img!.kind, "image");
  assert.equal(img!.mediaId, "MEDIA1");
  assert.equal(img!.text, "my car");
  assert.equal(loc!.kind, "location");
  assert.deepEqual(loc!.location, { latitude: 5.6, longitude: -0.19, name: "Accra" });
  assert.equal(stk!.kind, "unsupported");
  assert.equal(parsed.statuses.length, 2);
  assert.equal(parsed.statuses[0]!.status, "delivered");
  assert.equal(parsed.statuses[1]!.error, "131047 Re-engagement message");

  assert.deepEqual(parseWebhookPayload(null), { messages: [], statuses: [], phoneNumberIds: [] });
  assert.deepEqual(parseWebhookPayload({ entry: "nope" }), { messages: [], statuses: [], phoneNumberIds: [] });
});

test("delivery statuses only move forward", () => {
  assert.equal(nextMessageStatus("queued", "sent"), "sent");
  assert.equal(nextMessageStatus("sent", "delivered"), "delivered");
  assert.equal(nextMessageStatus("read", "delivered"), null);
  assert.equal(nextMessageStatus("delivered", "sent"), null);
  assert.equal(nextMessageStatus("sent", "failed"), "failed");
  assert.equal(nextMessageStatus("failed", "delivered"), null);
  assert.equal(nextMessageStatus(null, "read"), "read");
});

test("notification kinds map to templates", () => {
  assert.equal(templateForNotificationKind("offer.new"), "broker_new_offer");
  assert.equal(templateForNotificationKind("renewal.reminder"), "renewal_reminder");
  assert.equal(templateForNotificationKind("claim.status"), "claim_status_update");
  assert.equal(templateForNotificationKind("quote.ready"), "quote_ready");
  assert.equal(templateForNotificationKind("policy.issued"), "policy_documents_ready");
  assert.equal(templateForNotificationKind("invite.sent"), null);
});
