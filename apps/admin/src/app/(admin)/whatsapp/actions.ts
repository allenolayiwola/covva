"use server";
import { z } from "zod";
import { WA_TEMPLATES, isWaTemplateName, withinServiceWindow } from "@im/core";
import type { Json, Row } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyUsers } from "@/server/notify";
import { sendTemplate, sendText } from "@/server/whatsapp";

/**
 * Support console actions. Authorisation re-runs in every action (`whatsapp` perm:
 * platform_admin / platform_ops / support). Conversation triage uses the staff session
 * (RLS: staff update); sends and handoff bookkeeping use the service client so every
 * outbound message is logged in wa_messages exactly like the bot's.
 */
const Id = z.string().uuid();

function svc() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

type Loaded = { error: string; svc?: undefined } | { error?: undefined; svc: ReturnType<typeof createServiceClient>; conv: Row<"wa_conversations">; contact: Row<"wa_contacts"> };

async function loadConversation(conversationId: string): Promise<Loaded> {
  const s = svc();
  if (!s) return { error: "SUPABASE_SECRET_KEY is not configured on the admin project." };
  const { data: conv } = await s.from("wa_conversations").select("*").eq("id", conversationId).maybeSingle();
  if (!conv) return { error: "Conversation not found." };
  const { data: contact } = await s.from("wa_contacts").select("*").eq("id", conv.contact_id).maybeSingle();
  if (!contact) return { error: "Contact not found." };
  return { svc: s, conv, contact };
}

/** Take a conversation over from the bot (or another agent): status → human, assigned to me. */
export async function takeOver(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ conversationId: Id }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("wa_conversations").update({ status: "human", assigned_user_id: auth.staff.userId, closed_at: null }).eq("id", parsed.data.conversationId);
  if (error) return fail(dbMessage(error));
  const s = svc();
  if (s) {
    await s.from("wa_handoffs").insert({ conversation_id: parsed.data.conversationId, reason: "requested", to_party: "support", note: `Taken over by ${auth.staff.name ?? auth.staff.email ?? "staff"}` });
  }
  return done("You now own this conversation. The bot will stay quiet.");
}

/** Hand the conversation to a broker organisation (status → broker) and notify its advisers. */
export async function assignToBroker(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ conversationId: Id, orgId: Id, reason: z.enum(["advice", "claim", "requested", "unknown"]).default("requested"), note: z.string().trim().max(500).optional() }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const loaded = await loadConversation(parsed.data.conversationId);
  if (loaded.error !== undefined) return fail(loaded.error);
  const { data: org } = await loaded.svc.from("organizations").select("id, name, type, status").eq("id", parsed.data.orgId).maybeSingle();
  if (!org || org.type !== "broker" || org.status !== "active") return fail("Pick an active broker organisation.");
  const { error } = await loaded.svc.from("wa_conversations").update({ status: "broker", assigned_org_id: org.id, assigned_user_id: null, closed_at: null, topic: parsed.data.reason }).eq("id", loaded.conv.id);
  if (error) return fail(dbMessage(error));
  await loaded.svc.from("wa_handoffs").insert({ conversation_id: loaded.conv.id, reason: parsed.data.reason, to_party: "broker", org_id: org.id, request_id: loaded.conv.request_id, note: parsed.data.note || `Assigned by ${auth.staff.name ?? auth.staff.email ?? "staff"}` });
  const { data: members } = await loaded.svc.from("memberships").select("user_id").eq("org_id", org.id).eq("active", true).in("role", ["owner", "admin", "supervisor", "adviser"]);
  const web = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  await notifyUsers(
    (members ?? []).map((m) => ({
      userId: m.user_id,
      kind: "whatsapp.handoff",
      title: `WhatsApp: ${loaded.contact.display_name ?? "a customer"} needs ${parsed.data.reason === "advice" ? "advice" : "you"}`,
      body: `${parsed.data.note ?? "Covva support handed this conversation to you."} Reply from Partner workspace → WhatsApp.`,
      link: `${web}/partner/whatsapp?c=${loaded.conv.id}`,
      data: { conversation_id: loaded.conv.id },
      email: true,
    })),
  );
  return done(`Handed to ${org.name}.`);
}

/** Return the conversation to the bot. */
export async function backToBot(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ conversationId: Id }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("wa_conversations").update({ status: "bot", assigned_user_id: null, assigned_org_id: null, closed_at: null }).eq("id", parsed.data.conversationId);
  if (error) return fail(dbMessage(error));
  return done("Back with the assistant.");
}

export async function closeConversation(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ conversationId: Id, reason: z.string().trim().min(5).max(1000) }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("wa_conversations").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", parsed.data.conversationId);
  if (error) return fail(dbMessage(error));
  const s = svc();
  if (s) await s.from("wa_handoffs").update({ resolved_at: new Date().toISOString(), resolved_by: auth.staff.userId }).eq("conversation_id", parsed.data.conversationId).is("resolved_at", null);
  return done("Conversation closed.");
}

export async function resolveHandoff(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ handoffId: Id }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("wa_handoffs").update({ resolved_at: new Date().toISOString(), resolved_by: auth.staff.userId }).eq("id", parsed.data.handoffId);
  if (error) return fail(dbMessage(error));
  return done("Handoff resolved.");
}

/** Reply with free text (24-hour window only). */
export async function replyText(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ conversationId: Id, text: z.string().trim().min(1).max(4000) }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const loaded = await loadConversation(parsed.data.conversationId);
  if (loaded.error !== undefined) return fail(loaded.error);
  if (loaded.contact.opted_out_at) return fail("This contact opted out (STOP). Nothing can be sent until they message again.");
  if (!withinServiceWindow(loaded.contact.last_inbound_at)) return fail("The 24-hour window has closed. Send an approved template instead.");
  if (loaded.conv.status === "bot") await loaded.svc.from("wa_conversations").update({ status: "human", assigned_user_id: auth.staff.userId }).eq("id", loaded.conv.id);
  const r = await sendText(loaded.svc, loaded.contact, loaded.conv.id, parsed.data.text, auth.staff.userId);
  if (!r.ok) return fail(r.error ?? "The message was not sent.");
  return done("Sent.");
}

/** Send a registered template (allowed outside the window). Values are `var_<name>` fields. */
export async function replyTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const obj = formObject(fd);
  const parsed = z.object({ conversationId: Id, template: z.string().regex(/^[a-z0-9_]{3,80}$/) }).safeParse(obj);
  if (!parsed.success) return zodError(parsed.error);
  const loaded = await loadConversation(parsed.data.conversationId);
  if (loaded.error !== undefined) return fail(loaded.error);
  if (loaded.contact.opted_out_at) return fail("This contact opted out (STOP). Nothing can be sent until they message again.");
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (k.startsWith("var_") && typeof v === "string") values[k.slice(4)] = v.trim();
  if (loaded.conv.status === "bot") await loaded.svc.from("wa_conversations").update({ status: "human", assigned_user_id: auth.staff.userId }).eq("id", loaded.conv.id);
  const r = await sendTemplate(loaded.svc, loaded.contact, loaded.conv.id, parsed.data.template, values, auth.staff.userId);
  if (!r.ok) return fail(r.error ?? "The template was not sent.");
  return done("Template sent.");
}

/** Mark a contact as opted out (e.g. they asked by phone or email). Never un-opts anyone: only the contact can, by messaging again. */
export async function optOutContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ contactId: Id, reason: z.string().trim().min(5).max(1000) }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("wa_contacts").update({ opted_out_at: new Date().toISOString(), opted_in: false }).eq("id", parsed.data.contactId);
  if (error) return fail(dbMessage(error));
  await auth.supabase.from("wa_conversations").update({ status: "closed", closed_at: new Date().toISOString() }).eq("contact_id", parsed.data.contactId).neq("status", "closed");
  return done("Contact opted out. They can opt back in by messaging us.");
}

/** Link a contact to a user account by email (when the number is not on the profile). */
export async function linkContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsapp");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ contactId: Id, email: z.string().trim().email() }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data: profile } = await auth.supabase.from("profiles").select("id").eq("email", parsed.data.email.toLowerCase()).maybeSingle();
  if (!profile) return fail("No account with that email.");
  const { error } = await auth.supabase.from("wa_contacts").update({ user_id: profile.id }).eq("id", parsed.data.contactId);
  if (error) return fail(dbMessage(error));
  return done("Contact linked to the account.");
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------
const TemplateInput = z.object({
  name: z.string().regex(/^[a-z0-9_]{3,80}$/, "lower-case letters, digits and underscores"),
  language: z.string().trim().min(2).max(10).default("en"),
  category: z.enum(["utility", "marketing", "authentication"]),
  body: z.string().trim().min(1).max(1024),
  variables: z.string().trim().max(500).default(""),
  description: z.string().trim().max(500).optional(),
});

export async function saveTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsappTemplates");
  if (!auth.ok) return fail(auth.error);
  const parsed = TemplateInput.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const variables = parsed.data.variables.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
  const placeholders = [...parsed.data.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const max = placeholders.length ? Math.max(...placeholders) : 0;
  if (max !== variables.length) return fail(`The body uses ${max} placeholder(s) but ${variables.length} variable name(s) were given.`);
  const s = svc();
  if (!s) return fail("SUPABASE_SECRET_KEY is not configured on the admin project.");
  const { data: existing } = await s.from("wa_templates").select("id, status").eq("name", parsed.data.name).maybeSingle();
  const row = { name: parsed.data.name, language: parsed.data.language, category: parsed.data.category, body: parsed.data.body, variables, description: parsed.data.description ?? null, buttons: (isWaTemplateName(parsed.data.name) ? (WA_TEMPLATES[parsed.data.name].buttons ?? []) : []) as unknown as Json };
  const { error } = existing
    ? await s.from("wa_templates").update({ ...row, status: existing.status === "approved" ? "draft" : existing.status }).eq("id", existing.id)
    : await s.from("wa_templates").insert(row);
  if (error) return fail(dbMessage(error));
  return done(existing ? "Template updated (an edited approved template goes back to draft; resubmit it to Meta)." : "Template created as draft.");
}

export async function setTemplateStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("whatsappTemplates");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ templateId: Id, status: z.enum(["draft", "submitted", "approved", "rejected"]), metaTemplateId: z.string().trim().max(100).optional(), reason: z.string().trim().max(1000).optional() }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const s = svc();
  if (!s) return fail("SUPABASE_SECRET_KEY is not configured on the admin project.");
  const { error } = await s
    .from("wa_templates")
    .update({ status: parsed.data.status, meta_template_id: parsed.data.metaTemplateId || null, rejection_reason: parsed.data.status === "rejected" ? (parsed.data.reason ?? null) : null })
    .eq("id", parsed.data.templateId);
  if (error) return fail(dbMessage(error));
  return done(`Template marked ${parsed.data.status}.`);
}
