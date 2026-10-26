import "server-only";
import { classifyIntent, handoffReason, shouldOfferHuman, type WaInboundMessage, type WaIntent } from "@im/core";
import type { Json } from "@im/db";
import { log, mask } from "@/server/log";
import { notify, notifyOrg } from "@/server/notify";
import { afterOfferAccepted, rerouteIfRoundClosed } from "@/server/routing";
import { siteUrl } from "@/server/api-auth";
import { redactPII } from "@/server/ai/guardrails";
import { answerWhatsApp } from "./assistant";
import { performHandoff } from "./handoff";
import { ensureContact, openConversation, sendHumanOffer, sendText, type Svc, type WaContact, type WaConversation } from "./sender";

/**
 * Inbound conversation state machine. One call per inbound message, in order:
 *
 *   1. contact (upsert, link to a profile by phone) + open conversation + log the message
 *      (idempotent on wa_message_id: a retried webhook is a no-op),
 *   2. STOP → opted out, one confirmation, conversation closed, never messaged again
 *      until they write back (any later message re-opens / opts back in),
 *   3. 6-digit code → beneficiary consent (diaspora RPC, guarded: it may not exist yet),
 *   4. interactive Accept / Decline → broker one-tap offer through accept_order_offer (token),
 *   5. "human" / "broker" buttons or words → handoff,
 *   6. conversation already with a person → no bot; the assignee is pinged,
 *   7. quote / renew / claim / documents / pay → links (personalised for linked customers),
 *   8. otherwise the AI FAQ assistant; after three bot turns every reply offers a human.
 */
export interface RouteResult {
  action: string;
  conversationId?: string;
  duplicate?: boolean;
}

const site = () => siteUrl();

export async function routeInbound(svc: Svc, m: WaInboundMessage): Promise<RouteResult> {
  const contact = await ensureContact(svc, m.phone, { displayName: m.profileName });
  if (!contact) return { action: "ignored_invalid_number" };

  // Idempotency: Meta retries webhooks until it gets a 200.
  const { data: seen } = await svc.from("wa_messages").select("id, conversation_id").eq("wa_message_id", m.waMessageId).maybeSingle();
  if (seen) return { action: "duplicate", conversationId: seen.conversation_id, duplicate: true };

  const intent = classifyIntent(m.text, { buttonId: m.buttonId });

  // Re-opening after an opt-out: any non-STOP message opts the contact back in.
  if (contact.opted_out_at && intent.intent !== "stop") {
    await svc.from("wa_contacts").update({ opted_out_at: null, opted_in: true, opted_in_at: new Date().toISOString() }).eq("id", contact.id);
    contact.opted_out_at = null;
  } else if (!contact.opted_in && !contact.opted_out_at) {
    await svc.from("wa_contacts").update({ opted_in: true, opted_in_at: new Date().toISOString() }).eq("id", contact.id);
  }

  const conversation = await openConversation(svc, contact.id);
  if (!conversation) return { action: "no_conversation" };

  const { error: logErr } = await svc.from("wa_messages").insert({
    conversation_id: conversation.id,
    direction: "in",
    wa_message_id: m.waMessageId,
    kind: m.kind,
    body: m.text ? redactPII(m.text) : null,
    payload: { ...m.raw, _parsed: { kind: m.kind, buttonId: m.buttonId, mediaId: m.mediaId, mimeType: m.mimeType, location: m.location, contextMessageId: m.contextMessageId } } as unknown as Json,
    status: "received",
    sender_party: "customer",
    created_at: m.timestamp,
  });
  if (logErr) {
    if (logErr.code === "23505") return { action: "duplicate", conversationId: conversation.id, duplicate: true };
    log.warn("whatsapp.inbound_log_failed", { err: logErr });
  }
  // The trigger bumped last_inbound_at; reflect it locally so the window check passes.
  contact.last_inbound_at = new Date().toISOString();

  // 2. Opt-out
  if (intent.intent === "stop") {
    await svc.from("wa_contacts").update({ opted_out_at: new Date().toISOString(), opted_in: false }).eq("id", contact.id);
    await svc.from("wa_conversations").update({ status: "closed", closed_at: new Date().toISOString(), topic: "opt_out" }).eq("id", conversation.id);
    // One confirmation inside the window they just opened; nothing after this.
    await sendText(svc, contact, "You won't receive any more WhatsApp messages from Covva. Reply START at any time to switch them back on.", { conversationId: conversation.id, sender: "system" });
    return { action: "opted_out", conversationId: conversation.id };
  }
  if (intent.intent === "start") {
    await sendText(svc, contact, "Welcome back. You'll receive Covva updates on WhatsApp again. How can I help?", { conversationId: conversation.id, sender: "system" });
    return { action: "opted_in", conversationId: conversation.id };
  }

  // 3. Beneficiary consent code (diaspora)
  if (intent.intent === "consent_code" && intent.code) {
    const r = await confirmConsent(svc, contact, intent.code);
    await sendText(svc, contact, r.reply, { conversationId: conversation.id, sender: "system" });
    return { action: r.ok ? "consent_confirmed" : "consent_failed", conversationId: conversation.id };
  }

  // 4. Broker one-tap accept / decline
  if ((intent.intent === "accept_offer" || intent.intent === "decline_offer") && intent.token) {
    const r = intent.intent === "accept_offer" ? await acceptOffer(svc, contact, intent.token) : await declineOffer(svc, intent.token);
    await sendText(svc, contact, r.reply, { conversationId: conversation.id, sender: "system" });
    return { action: r.ok ? intent.intent : `${intent.intent}_failed`, conversationId: conversation.id };
  }
  if (intent.intent === "accept_offer" && !intent.token) {
    await sendText(svc, contact, "To accept a request, tap the Accept button on the offer message or open the link in it. Offers can only be accepted from the broker workspace or that button.", { conversationId: conversation.id, sender: "bot" });
    return { action: "accept_without_token", conversationId: conversation.id };
  }

  // 5. Explicit handoff requests
  if (intent.intent === "human" || intent.intent === "broker" || intent.intent === "advice") {
    const h = handoffReason(intent.intent)!;
    if (conversation.status === "human" || conversation.status === "broker") {
      await pingAssignee(svc, contact, conversation, m.text);
      return { action: "already_with_person", conversationId: conversation.id };
    }
    const r = await performHandoff(svc, { contact, conversation, reason: h.reason, to: h.to, note: m.text ? redactPII(m.text).slice(0, 300) : null });
    const reply =
      r.to === "broker"
        ? `Your broker, ${r.orgName ?? "the licensed broker handling your cover"}, will take over this chat and reply here. Brokers advise you as licensed professionals; Covva only provides the technology.`
        : "A member of the Covva support team will take over this chat and reply here as soon as possible (usually within business hours). If it's urgent, call your insurer's helpline on your policy document.";
    await sendText(svc, contact, reply, { conversationId: conversation.id, sender: "system" });
    return { action: `handoff_${r.to}`, conversationId: conversation.id };
  }

  // 6. Already with a person: ping them, no bot reply.
  if (conversation.status === "human" || conversation.status === "broker") {
    await pingAssignee(svc, contact, conversation, m.text);
    return { action: "forwarded_to_person", conversationId: conversation.id };
  }

  // 7. Journeys with links
  const links = await journeyReply(svc, contact, conversation, intent.intent);
  if (links) {
    await sendText(svc, contact, links, { conversationId: conversation.id, sender: "bot" });
    if (shouldOfferHuman(conversation.bot_turns + 1)) await offerHuman(svc, contact, conversation);
    return { action: `journey_${intent.intent}`, conversationId: conversation.id };
  }

  // 8. AI FAQ
  if (m.kind !== "text" && m.kind !== "interactive") {
    await sendText(svc, contact, "Thanks — I can only read text messages here. If you're sending documents for a claim or a request, please upload them in the Covva app so your broker and insurer receive them safely. Type \"human\" to reach our team.", { conversationId: conversation.id, sender: "bot" });
    return { action: "unsupported_kind", conversationId: conversation.id };
  }
  const history = await recentHistory(svc, conversation.id, m.waMessageId);
  const ai = await answerWhatsApp(svc, {
    contact,
    conversation,
    history,
    userText: m.text ?? "",
    context: [`Useful links: quotes ${site()}/get-started, help centre ${site()}/support, sign in ${site()}/account.`],
  });
  const verdictHandoff = ai.handoff ? handoffReason(intent.intent, ai.handoff.reason) : null;
  await sendText(svc, contact, ai.reply, { conversationId: conversation.id, sender: "bot" });
  if (verdictHandoff && ai.handoff) {
    const r = await performHandoff(svc, { contact, conversation, reason: verdictHandoff.reason, to: verdictHandoff.to, note: ai.handoff.note });
    const follow = r.to === "broker" ? `${r.orgName ?? "Your broker"} will continue this chat with you here.` : "Our support team will continue this chat with you here.";
    await sendText(svc, contact, follow, { conversationId: conversation.id, sender: "system" });
    return { action: `ai_handoff_${r.to}`, conversationId: conversation.id };
  }
  if (shouldOfferHuman(conversation.bot_turns + 1)) await offerHuman(svc, contact, conversation);
  return { action: ai.usedModel ? "ai_reply" : "fallback_reply", conversationId: conversation.id };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function recentHistory(svc: Svc, conversationId: string, excludeWaId: string) {
  const { data } = await svc
    .from("wa_messages")
    .select("direction, body, kind, wa_message_id, sender_party")
    .eq("conversation_id", conversationId)
    .in("kind", ["text", "interactive"])
    .order("created_at", { ascending: false })
    .limit(12);
  return (data ?? [])
    .filter((r) => r.body && r.wa_message_id !== excludeWaId && (r.direction === "in" || r.sender_party === "bot"))
    .reverse()
    .map((r) => ({ role: r.direction === "in" ? ("user" as const) : ("assistant" as const), text: r.body!.slice(0, 1000) }));
}

async function offerHuman(svc: Svc, contact: WaContact, conversation: WaConversation) {
  await sendHumanOffer(svc, contact, "Would you like a person to take over? Our support team can help with your account, and your broker gives advice as a licensed professional.", { conversationId: conversation.id, sender: "bot" });
}

async function pingAssignee(svc: Svc, contact: WaContact, conversation: WaConversation, text: string | null) {
  const who = contact.display_name ?? mask(contact.phone) ?? "WhatsApp contact";
  const body = text ? redactPII(text).slice(0, 300) : "(non-text message)";
  if (conversation.status === "broker" && conversation.assigned_org_id) {
    await notifyOrg(conversation.assigned_org_id, { kind: "whatsapp.message", title: `WhatsApp from ${who}`, body, link: `/partner/whatsapp?c=${conversation.id}`, data: { conversation_id: conversation.id }, channels: ["in_app", "push"] }, ["owner", "admin", "supervisor", "adviser"]);
  } else if (conversation.assigned_user_id) {
    await notify({ userId: conversation.assigned_user_id, kind: "whatsapp.message", title: `WhatsApp from ${who}`, body, link: `${(process.env.NEXT_PUBLIC_ADMIN_URL ?? "").replace(/\/$/, "")}/whatsapp?c=${conversation.id}`, data: { conversation_id: conversation.id }, channels: ["in_app", "email"] });
  } else {
    const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
    if (platform) await notifyOrg(platform.id, { kind: "whatsapp.message", title: `WhatsApp from ${who} (unassigned)`, body, link: `${(process.env.NEXT_PUBLIC_ADMIN_URL ?? "").replace(/\/$/, "")}/whatsapp?c=${conversation.id}`, data: { conversation_id: conversation.id }, channels: ["in_app"] }, ["platform_admin", "platform_ops", "support"]);
  }
}

/** Canned replies with the right link for the common journeys. Null when the intent is not a journey. */
async function journeyReply(svc: Svc, contact: WaContact, conversation: WaConversation, intent: WaIntent): Promise<string | null> {
  const uid = contact.user_id;
  const base = site();
  const human = "Type \"human\" for our support team or \"broker\" for your broker.";
  switch (intent) {
    case "greeting":
      return `Hello${contact.display_name ? ` ${contact.display_name.split(" ")[0]}` : ""}, this is Covva's assistant. I can help with quotes, renewals, claims, documents and payments, or answer questions about how Covva works. What do you need? ${human} (English for now; Twi, Ga and Ewe are coming.)`;
    case "quote": {
      if (uid) {
        const { data: open } = await svc.from("requests").select("id, reference, status").eq("customer_id", uid).in("status", ["quotes_ready", "insurer_response"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (open) {
          await svc.from("wa_conversations").update({ request_id: open.id, topic: "quote" }).eq("id", conversation.id);
          return `Your quotes for ${open.reference} are ready to compare: ${base}/account/requests/${open.id}\nQuotes come from participating licensed insurers; your broker of record advises you on them. Prices are only ever shown in the app, never here.`;
        }
      }
      return `Getting quotes is free. Start here and a licensed broker will arrange your cover: ${base}/get-started\nQuotes come from participating insurers; I can't quote prices in this chat. ${human}`;
    }
    case "renew": {
      if (uid) {
        const { data: pol } = await svc.from("policies").select("id, internal_reference, policy_number, cover_end").eq("customer_id", uid).eq("status", "active").order("cover_end", { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
        if (pol) {
          await svc.from("wa_conversations").update({ policy_id: pol.id, topic: "renew" }).eq("id", conversation.id);
          return `Policy ${pol.policy_number ?? pol.internal_reference}${pol.cover_end ? ` ends on ${pol.cover_end}` : ""}. Renew with refreshed quotes here: ${base}/account/policies/${pol.id}/renew\nAny renewal price is an estimate until the insurer confirms it.`;
        }
      }
      return `You can renew from your policy wallet: ${base}/account/policies — open the policy and tap Renew. If your policy was bought elsewhere, add it to your wallet first. ${human}`;
    }
    case "claim": {
      let link = `${base}/account/claims/new`;
      if (uid) {
        const { data: pol } = await svc.from("policies").select("id").eq("customer_id", uid).in("status", ["active", "expired", "lapsed", "renewed"]).order("cover_end", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        if (pol) {
          link = `${base}/account/claims/new?policy=${pol.id}`;
          await svc.from("wa_conversations").update({ policy_id: pol.id, topic: "claim" }).eq("id", conversation.id);
        }
      }
      return `Sorry to hear that. Report the claim here so your broker and insurer get it straight away: ${link}\nYour broker helps you submit it; the insurer assesses and decides the claim. Reporting a claim is not approval. If anyone is hurt, call emergency services first (112).`;
    }
    case "documents":
      return `Your policy documents live in your Covva wallet: ${base}/account/documents\nSchedules and certificates appear there as soon as the insurer issues them. ${human}`;
    case "pay": {
      if (uid) {
        const { data: app } = await svc.from("applications").select("id, request_id, status").eq("customer_id", uid).in("status", ["draft", "submitted"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (app) {
          await svc.from("wa_conversations").update({ request_id: app.request_id, topic: "pay" }).eq("id", conversation.id);
          return `Finish your application and pay securely here: ${base}/account/requests/${app.request_id}/apply\nPayments go through an authorised payment provider straight to the insurer (mobile money, card or bank transfer). Paying is not the same as being covered: your policy is active once the insurer issues it.`;
        }
      }
      return `Premiums are paid in the app by mobile money, card or bank transfer, through an authorised payment provider directly to the insurer — Covva never holds your premium. Sign in to pay: ${base}/account\nIf you've paid and something looks wrong, type "human" and our team will check it.`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Diaspora consent (RPC owned by the diaspora stream; may not exist yet)
// ---------------------------------------------------------------------------
async function confirmConsent(svc: Svc, contact: WaContact, code: string): Promise<{ ok: boolean; reply: string }> {
  try {
    // The function is owned by the diaspora migration and may not exist yet: call it untyped.
    const untyped = svc as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
    const { data, error } = await untyped.rpc("confirm_beneficiary_consent", { p_phone: contact.phone, p_code: code });
    if (error) {
      if (error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "")) {
        log.warn("whatsapp.consent_rpc_missing");
        return { ok: false, reply: "Thanks. Consent codes aren't live on WhatsApp yet — please reply to the SMS you received, or ask the person arranging your cover to try again later." };
      }
      log.info("whatsapp.consent_rejected", { code: error.code, message: error.message });
      return { ok: false, reply: error.code === "P0001" && error.message ? error.message : "That code didn't match or has expired. Ask the person arranging your cover to send a new one." };
    }
    const ok = data === true || (data && typeof data === "object" && (data as { ok?: boolean }).ok !== false);
    return ok
      ? { ok: true, reply: "Thank you — your consent is confirmed. The person arranging your cover can now continue. You'll receive your policy documents here and in the Covva app once the insurer issues them." }
      : { ok: false, reply: "That code didn't match or has expired. Ask the person arranging your cover to send a new one." };
  } catch (err) {
    log.warn("whatsapp.consent_error", { err });
    return { ok: false, reply: "Sorry, we couldn't check that code right now. Please try again in a few minutes." };
  }
}

// ---------------------------------------------------------------------------
// Broker one-tap accept / decline (service role, token from the template button)
// ---------------------------------------------------------------------------
async function acceptOffer(svc: Svc, contact: WaContact, token: string): Promise<{ ok: boolean; reply: string }> {
  const { data, error } = await svc.rpc("accept_order_offer", { p_token: token });
  if (error) {
    log.info("whatsapp.offer_accept_rejected", { code: error.code, message: error.message, contact: contact.id });
    return { ok: false, reply: error.code === "P0001" && error.message ? `${error.message}. Open your Offers page in the partner workspace: ${site()}/partner/offers` : `We couldn't accept that offer. Open your Offers page: ${site()}/partner/offers` };
  }
  const accepted = data?.[0];
  if (!accepted) return { ok: false, reply: `That offer is no longer open. See your current offers: ${site()}/partner/offers` };
  try {
    await afterOfferAccepted(svc, { request_id: accepted.request_id, broker_org_id: accepted.broker_org_id, reference: accepted.reference, customer_id: accepted.customer_id });
  } catch {
    /* best effort; follow-ups are retried by cron */
  }
  return { ok: true, reply: `Accepted. Your organisation is now broker of record for ${accepted.reference}. Open it in the workspace: ${site()}/partner/requests/${accepted.request_id}` };
}

async function declineOffer(svc: Svc, token: string): Promise<{ ok: boolean; reply: string }> {
  const { data: offer } = await svc.from("order_offers").select("id, request_id").eq("accept_token", token).maybeSingle();
  if (!offer) return { ok: false, reply: "That offer is no longer open." };
  const { data, error } = await svc.rpc("decline_order_offer", { p_offer_id: offer.id });
  if (error) return { ok: false, reply: error.code === "P0001" && error.message ? error.message : "We couldn't decline that offer." };
  const declined = data?.[0];
  if (declined && declined.open_offers === 0) {
    try {
      await rerouteIfRoundClosed(svc, declined.request_id);
    } catch {
      /* cron picks it up */
    }
  }
  return { ok: true, reply: "Declined. The request is being offered to the next broker." };
}
