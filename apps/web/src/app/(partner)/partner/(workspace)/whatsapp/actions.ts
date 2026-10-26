"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { withinServiceWindow } from "@im/core";
import { createServiceClient } from "@/lib/supabase/server";
import { sendTemplate, sendText } from "@/server/whatsapp/sender";
import { ActionError, ROLES, actionContext, run, type ActionState } from "../../_lib/context";

/**
 * Broker replies to WhatsApp conversations handed to their organisation. The RLS-scoped
 * read proves the conversation belongs to the active org; the send then goes through the
 * service-role sender so it is logged like every other outbound message.
 */
async function ownedConversation(conversationId: string) {
  const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
  const { data: conv } = await ctx.supabase.from("wa_conversations").select("id, status, contact_id, assigned_org_id").eq("id", conversationId).maybeSingle();
  if (!conv || conv.assigned_org_id !== ctx.orgId) throw new ActionError("This conversation is not assigned to your organisation.");
  if (conv.status !== "broker") throw new ActionError("This conversation is no longer with you.");
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    throw new ActionError("WhatsApp sending is not configured on this environment.");
  }
  const { data: contact } = await svc.from("wa_contacts").select("*").eq("id", conv.contact_id).maybeSingle();
  if (!contact) throw new ActionError("Contact not found.");
  return { ctx, conv, contact, svc };
}

export async function brokerReply(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const input = z.object({ conversationId: z.string().uuid(), text: z.string().trim().min(1).max(4000) }).parse({ conversationId: formData.get("conversationId"), text: formData.get("text") });
    const { ctx, conv, contact, svc } = await ownedConversation(input.conversationId);
    if (contact.opted_out_at) throw new ActionError("The customer opted out of WhatsApp messages.");
    if (!withinServiceWindow(contact.last_inbound_at)) throw new ActionError("The 24-hour window has closed. Send the \"info request\" template to re-open the conversation.");
    const r = await sendText(svc, contact, input.text, { conversationId: conv.id, sender: "broker", senderUserId: ctx.userId });
    if (!r.ok) throw new ActionError(r.error ?? "The message was not sent.");
    refresh();
    return { ok: true, message: "Sent." };
  });
}

export async function brokerInfoRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const input = z.object({ conversationId: z.string().uuid(), reference: z.string().trim().min(1).max(60), what: z.string().trim().min(3).max(300) }).parse({ conversationId: formData.get("conversationId"), reference: formData.get("reference"), what: formData.get("what") });
    const { ctx, conv, contact, svc } = await ownedConversation(input.conversationId);
    if (contact.opted_out_at) throw new ActionError("The customer opted out of WhatsApp messages.");
    const link = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://covva.com.gh").replace(/\/$/, "")}/account`;
    const r = await sendTemplate(svc, contact, "info_request", { name: contact.display_name?.split(" ")[0] ?? "there", broker: ctx.orgName, reference: input.reference, what: input.what, link }, { conversationId: conv.id, sender: "broker", senderUserId: ctx.userId });
    if (!r.ok) throw new ActionError(r.error ?? "The template was not sent.");
    refresh();
    return { ok: true, message: "Template sent." };
  });
}

/** Done with the customer: close the conversation (they can always message again). */
export async function brokerClose(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const conversationId = z.string().uuid().parse(formData.get("conversationId"));
    const { ctx, conv, svc } = await ownedConversation(conversationId);
    await svc.from("wa_conversations").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", conv.id);
    await svc.from("wa_handoffs").update({ resolved_at: new Date().toISOString(), resolved_by: ctx.userId }).eq("conversation_id", conv.id).is("resolved_at", null);
    refresh();
    return { ok: true, message: "Conversation closed." };
  });
}
