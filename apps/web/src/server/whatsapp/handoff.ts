import "server-only";
import type { WaHandoffParty, WaHandoffReason } from "@im/core";
import { createServiceClient } from "@/lib/supabase/server";
import { log, mask } from "@/server/log";
import { notify, notifyOrg } from "@/server/notify";

/**
 * Hand a WhatsApp conversation to a person: the customer's broker of record (advice,
 * claims) or the support team (complaints, payment problems, "human", unknown).
 *
 * Records a `wa_handoffs` row, moves the conversation to `broker` / `human`, opens a
 * complaint (known customer + complaint) or a callback lead (unknown number) and notifies
 * the receiving party in-app / email. Never throws: the bot's reply must still go out.
 */
type Svc = ReturnType<typeof createServiceClient>;

export interface HandoffInput {
  contact: { id: string; phone: string; user_id: string | null; display_name: string | null };
  conversation: { id: string; request_id: string | null; policy_id: string | null; claim_id: string | null };
  reason: WaHandoffReason;
  to: WaHandoffParty;
  /** Short summary of what the person asked (redacted). */
  note?: string | null;
}

export interface HandoffResult {
  handoffId: string | null;
  to: WaHandoffParty;
  orgId: string | null;
  orgName: string | null;
  complaintId: string | null;
  leadId: string | null;
}

/** The customer's broker of record: the broker on their most recent request or policy. */
export async function brokerOfRecord(svc: Svc, userId: string): Promise<{ id: string; name: string } | null> {
  const [{ data: req }, { data: pol }] = await Promise.all([
    svc.from("requests").select("broker_org_id, created_at").eq("customer_id", userId).not("broker_org_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    svc.from("policies").select("broker_org_id, created_at").eq("customer_id", userId).not("broker_org_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const candidates = [req, pol].filter((r): r is { broker_org_id: string; created_at: string } => !!r?.broker_org_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const orgId = candidates[0]?.broker_org_id;
  if (!orgId) return null;
  const { data: org } = await svc.from("organizations").select("id, name, status").eq("id", orgId).maybeSingle();
  return org && org.status === "active" ? { id: org.id, name: org.name } : null;
}

async function platformOrgId(svc: Svc): Promise<string | null> {
  const { data } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function performHandoff(svc: Svc, input: HandoffInput): Promise<HandoffResult> {
  const result: HandoffResult = { handoffId: null, to: input.to, orgId: null, orgName: null, complaintId: null, leadId: null };
  try {
    let to = input.to;
    let broker: { id: string; name: string } | null = null;
    if (to === "broker" && input.contact.user_id) broker = await brokerOfRecord(svc, input.contact.user_id);
    if (to === "broker" && !broker) to = "support"; // no broker of record yet → support assigns one
    result.to = to;

    if (to === "support") {
      if (input.reason === "complaint" && input.contact.user_id) {
        const { data: c } = await svc
          .from("complaints")
          .insert({
            customer_id: input.contact.user_id,
            request_id: input.conversation.request_id,
            policy_id: input.conversation.policy_id,
            claim_id: input.conversation.claim_id,
            against_party: "platform",
            category: "whatsapp",
            subject: "Complaint raised on WhatsApp",
            description: input.note?.slice(0, 4000) || "The customer raised a complaint in the WhatsApp chat. See the conversation in the support console.",
          })
          .select("id")
          .maybeSingle();
        result.complaintId = c?.id ?? null;
      } else if (!input.contact.user_id) {
        const { data: lead } = await svc
          .from("leads")
          .insert({
            kind: "customer",
            name: input.contact.display_name ?? "WhatsApp contact",
            phone: input.contact.phone,
            message: `WhatsApp callback (${input.reason}): ${input.note?.slice(0, 2000) ?? "asked to talk to a person"}`,
            source_page: "whatsapp",
            utm: { source: "whatsapp", conversation_id: input.conversation.id },
          })
          .select("id")
          .maybeSingle();
        result.leadId = lead?.id ?? null;
      }
    } else if (broker) {
      result.orgId = broker.id;
      result.orgName = broker.name;
    }

    const { data: h } = await svc
      .from("wa_handoffs")
      .insert({
        conversation_id: input.conversation.id,
        reason: input.reason,
        to_party: to,
        org_id: result.orgId,
        complaint_id: result.complaintId,
        request_id: input.conversation.request_id,
        lead_id: result.leadId,
        note: input.note?.slice(0, 2000) ?? null,
      })
      .select("id")
      .maybeSingle();
    result.handoffId = h?.id ?? null;

    await svc
      .from("wa_conversations")
      .update(to === "broker" ? { status: "broker", assigned_org_id: result.orgId, topic: input.reason } : { status: "human", topic: input.reason })
      .eq("id", input.conversation.id);

    const who = input.contact.display_name ?? mask(input.contact.phone) ?? "a WhatsApp contact";
    if (to === "broker" && result.orgId) {
      await notifyOrg(
        result.orgId,
        {
          kind: "whatsapp.handoff",
          title: `WhatsApp: ${who} needs ${input.reason === "advice" ? "advice" : input.reason === "claim" ? "help with a claim" : "you"}`,
          body: `${input.note?.slice(0, 300) ?? "A customer asked for their broker."} Reply from Partner workspace → WhatsApp (within 24 hours of their last message).`,
          link: `/partner/whatsapp?c=${input.conversation.id}`,
          data: { conversation_id: input.conversation.id, handoff_id: result.handoffId, reason: input.reason },
          channels: ["in_app", "push", "email"],
        },
        ["owner", "admin", "supervisor", "adviser"],
      );
    } else {
      const platform = await platformOrgId(svc);
      if (platform) {
        await notifyOrg(
          platform,
          {
            kind: "whatsapp.handoff",
            title: `WhatsApp: ${who} needs a person (${input.reason.replace(/_/g, " ")})`,
            body: `${input.note?.slice(0, 300) ?? "The bot handed this conversation over."} Take it over in Admin → WhatsApp.`,
            link: `${(process.env.NEXT_PUBLIC_ADMIN_URL ?? "").replace(/\/$/, "")}/whatsapp?c=${input.conversation.id}`,
            data: { conversation_id: input.conversation.id, handoff_id: result.handoffId, reason: input.reason, complaint_id: result.complaintId, lead_id: result.leadId },
            channels: ["in_app", "email"],
          },
          ["platform_admin", "platform_ops", "support"],
        );
      }
    }
    if (input.contact.user_id && result.complaintId) {
      await notify({ userId: input.contact.user_id, kind: "complaint.filed", title: "We logged your complaint", body: "A member of the team will get back to you within two working days.", link: `/account/complaints/${result.complaintId}`, channels: ["in_app"] });
    }
  } catch (err) {
    log.error("whatsapp.handoff_failed", { conversationId: input.conversation.id, err });
  }
  return result;
}
