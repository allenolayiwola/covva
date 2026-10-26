import "server-only";
import { after } from "next/server";
import { ROLE_STATEMENTS, webPathToDeepLink } from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log, mask } from "@/server/log";

/**
 * Notification fan-out (owner: Backend stream): in-app row + email + SMS + push
 * according to the user's notification_prefs.
 *
 * Uses the service client: notifications are system writes for *other* users,
 * which RLS deliberately does not allow from a user session.
 */
export interface NotifyInput {
  userId: string;
  kind: string;            // e.g. "quote.ready", "policy.issued", "claim.status"
  title: string;
  body?: string;
  link?: string;           // web path; mobile maps it to a deep link
  data?: Record<string, unknown>;
  channels?: ("in_app" | "email" | "sms" | "push")[];
}

type Channel = NonNullable<NotifyInput["channels"]>[number];

/**
 * Kinds that also go out by SMS when the caller doesn't pass `channels`.
 * SMS costs money and is intrusive, so only status changes a customer must act on.
 */
const SMS_KINDS = new Set([
  "payment.succeeded", "payment.failed", "policy.issued", "claim.status", "renewal.reminder",
  "request.action_required", "quote.ready",
]);

function defaultChannels(kind: string): Channel[] {
  return SMS_KINDS.has(kind) ? ["in_app", "push", "email", "sms"] : ["in_app", "push", "email"];
}

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Run work after the response when inside a request; otherwise run it now. */
function defer(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
    return Promise.resolve();
  } catch {
    return task();
  }
}

export async function notify(input: NotifyInput | NotifyInput[]): Promise<void> {
  const items = (Array.isArray(input) ? input : [input]).filter((i) => i.userId && i.title);
  if (!items.length) return;
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch (err) {
    log.warn("notify.unconfigured", { err });
    return;
  }

  const rows = items.map((i) => ({
    user_id: i.userId,
    kind: i.kind,
    title: i.title.slice(0, 200),
    body: i.body?.slice(0, 2000) ?? null,
    link: i.link ?? null,
    data: (i.data ?? {}) as Json,
    channels: i.channels ?? defaultChannels(i.kind),
  }));
  const { data: inserted, error } = await svc.from("notifications").insert(rows).select("id, user_id, kind, title, body, link, data, channels");
  if (error || !inserted) {
    log.error("notify.insert_failed", { err: error });
    return;
  }
  await defer(() => deliver(svc, inserted));
}

/** Notify every active member of an organisation (optionally filtered by role). */
export async function notifyOrg(orgId: string, input: Omit<NotifyInput, "userId">, roles?: string[]): Promise<void> {
  if (!orgId) return;
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    return;
  }
  let q = svc.from("memberships").select("user_id, role").eq("org_id", orgId).eq("active", true);
  if (roles?.length) q = q.in("role", roles as never[]);
  const { data } = await q;
  const userIds = [...new Set((data ?? []).map((m) => m.user_id))];
  if (userIds.length) await notify(userIds.map((userId) => ({ ...input, userId })));
}

// ---------------------------------------------------------------------------
// Team invitations (recipient may not have an account yet)
// ---------------------------------------------------------------------------
/**
 * Email a team invitation. When the address belongs to an existing user it goes through
 * `notify()` (in-app + email, kind `invite.sent`); otherwise the email is sent directly
 * with `sendEmail()` — invitations are the one message we must deliver to people with
 * no account. Degrades to a log line when `RESEND_API_KEY` is unset.
 */
export async function sendInviteEmail(input: { to: string; orgName: string; role: string; token: string; invitedBy?: string | null; expiresAt?: string | null }): Promise<void> {
  const link = `${siteUrl()}/invite/${encodeURIComponent(input.token)}`;
  const role = input.role.replace(/_/g, " ");
  const title = `You're invited to join ${input.orgName} on COVVA`;
  const body = [
    `${input.invitedBy ? `${input.invitedBy} has` : "You have been"} invited you to join ${input.orgName} as ${/^[aeiou]/i.test(role) ? "an" : "a"} ${role}.`,
    "Open the link below and sign in with this email address (or create an account with it) to accept.",
    input.expiresAt ? `The invitation expires on ${input.expiresAt.slice(0, 10)}.` : "The invitation expires in 14 days.",
  ].join("\n");

  let svc: ReturnType<typeof createServiceClient> | null = null;
  try {
    svc = createServiceClient();
  } catch {
    svc = null;
  }
  if (svc) {
    const { data: existing } = await svc.from("profiles").select("id").eq("email", input.to.toLowerCase()).maybeSingle();
    if (existing) {
      await notify({ userId: existing.id, kind: "invite.sent", title, body, link, data: { org_name: input.orgName, role: input.role }, channels: ["in_app", "email", "push"] });
      return;
    }
  }
  await defer(async () => {
    await sendEmail({ to: input.to, subject: title, html: emailHtml({ title, body, link }), text: emailText({ title, body, link }) });
  });
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------
type Inserted = { id: string; user_id: string; kind: string; title: string; body: string | null; link: string | null; data: Json; channels: string[] };
type Svc = ReturnType<typeof createServiceClient>;

interface Prefs { email?: boolean; sms?: boolean; push?: boolean; whatsapp?: boolean }

async function deliver(svc: Svc, rows: Inserted[]) {
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: profiles }, { data: devices }] = await Promise.all([
    svc.from("profiles").select("id, email, phone, full_name, preferred_name, notification_prefs").in("id", userIds),
    svc.from("device_tokens").select("token, user_id, provider").in("user_id", userIds),
  ]);
  const byUser = new Map((profiles ?? []).map((p) => [p.id, p]));
  const pushMessages: { notificationId: string; token: string; message: ExpoMessage }[] = [];
  const results = new Map<string, Record<string, unknown>>();

  await Promise.all(
    rows.map(async (n) => {
      const p = byUser.get(n.user_id);
      const prefs = (p?.notification_prefs ?? {}) as Prefs;
      const delivered: Record<string, unknown> = { in_app: true };
      const want = new Set(n.channels);

      if (want.has("email")) {
        if (prefs.email === false) delivered.email = { skipped: "opted_out" };
        else if (!p?.email) delivered.email = { skipped: "no_address" };
        else delivered.email = await sendEmail({ to: p.email, subject: n.title, html: emailHtml(n, p.preferred_name || p.full_name), text: emailText(n) });
      }
      if (want.has("sms")) {
        if (prefs.sms === false) delivered.sms = { skipped: "opted_out" };
        else if (!p?.phone) delivered.sms = { skipped: "no_number" };
        else delivered.sms = await sendSms(p.phone, smsText(n));
      }
      if (want.has("push")) {
        const tokens = (devices ?? []).filter((d) => d.user_id === n.user_id && d.provider === "expo");
        if (prefs.push === false) delivered.push = { skipped: "opted_out" };
        else if (!tokens.length) delivered.push = { skipped: "no_devices" };
        else {
          const deep = webPathToDeepLink(n.link);
          for (const t of tokens) {
            pushMessages.push({
              notificationId: n.id,
              token: t.token,
              message: {
                to: t.token,
                title: n.title,
                body: n.body ?? undefined,
                sound: "default",
                channelId: "default",
                priority: "high",
                data: { ...(n.data as Record<string, unknown>), notificationId: n.id, kind: n.kind, url: deep.url, path: deep.path, webLink: n.link },
              },
            });
          }
        }
      }
      results.set(n.id, delivered);
    }),
  );

  if (pushMessages.length) {
    const pushResults = await sendExpoPush(svc, pushMessages);
    for (const [id, r] of pushResults) {
      const d = results.get(id);
      if (d) d.push = r;
    }
  }

  await Promise.all(
    [...results].map(([id, delivered]) => svc.from("notifications").update({ delivered: delivered as Json }).eq("id", id)),
  );
}

// ---------------------------------------------------------------------------
// Email (Resend REST API)
// ---------------------------------------------------------------------------
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function absoluteLink(link: string | null) {
  if (!link) return null;
  return /^https?:\/\//.test(link) ? link : `${siteUrl()}${link.startsWith("/") ? "" : "/"}${link}`;
}

export function emailHtml(n: Pick<Inserted, "title" | "body" | "link">, name?: string | null): string {
  const href = absoluteLink(n.link);
  const body = n.body ? escapeHtml(n.body).replace(/\n/g, "<br>") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(n.title)}</title></head>
<body style="margin:0;background:#F1F7F3;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#26434C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F7F3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #DCE3E1;border-radius:16px;overflow:hidden">
<tr><td style="background:#00796E;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.2px">
<span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#ffffff;color:#00796E;border-radius:8px;margin-right:10px;font-weight:800">i</span>COVVA</td></tr>
<tr><td style="padding:28px 24px 8px">
${name ? `<p style="margin:0 0 12px;font-size:15px">Hello ${escapeHtml(name)},</p>` : ""}
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#15343E">${escapeHtml(n.title)}</h1>
${body ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${body}</p>` : ""}
${href ? `<p style="margin:0 0 24px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#00796E;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:15px">View details</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #DCE3E1;font-size:12px;line-height:1.6;color:#6F858C">
${escapeHtml(ROLE_STATEMENTS.platform)} ${escapeHtml(ROLE_STATEMENTS.payment)}<br>
You can change how we contact you in your account settings.
</td></tr></table></td></tr></table></body></html>`;
}

function emailText(n: Pick<Inserted, "title" | "body" | "link">) {
  const href = absoluteLink(n.link);
  return [n.title, "", n.body ?? "", href ? `\nView details: ${href}` : "", "", "—", ROLE_STATEMENTS.platform].join("\n");
}

export async function sendEmail(msg: { to: string; subject: string; html: string; text?: string }): Promise<Record<string, unknown>> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    log.info("email.log", { to: mask(msg.to), subject: msg.subject });
    return { ok: true, provider: "log" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "COVVA <no-reply@covva.com.gh>",
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      log.warn("email.failed", { status: res.status, message: json.message });
      return { ok: false, provider: "resend", status: res.status, error: json.message };
    }
    return { ok: true, provider: "resend", id: json.id };
  } catch (err) {
    log.warn("email.error", { err });
    return { ok: false, provider: "resend", error: "network" };
  }
}

// ---------------------------------------------------------------------------
// SMS (provider adapter: log | arkesel | hubtel)
// ---------------------------------------------------------------------------
function smsText(n: Pick<Inserted, "title" | "body" | "link">) {
  const href = absoluteLink(n.link);
  const text = `${n.title}${n.body ? `. ${n.body}` : ""}`;
  const out = `${text.slice(0, href ? 240 : 300)}${href ? ` ${href}` : ""}`;
  return out;
}

/** Normalise Ghana numbers to 233XXXXXXXXX (no plus) as both providers expect. */
export function normaliseGhanaPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

export async function sendSms(phone: string, message: string): Promise<Record<string, unknown>> {
  const provider = (process.env.SMS_PROVIDER ?? "log").toLowerCase();
  const to = normaliseGhanaPhone(phone);
  const sender = (process.env.SMS_SENDER_ID ?? "COVVA").slice(0, 11);
  try {
    if (provider === "arkesel") {
      const key = process.env.SMS_API_KEY;
      if (!key) return { ok: false, provider, error: "SMS_API_KEY not set" };
      const res = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
        method: "POST",
        headers: { "api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ sender, message, recipients: [to] }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
      return { ok: res.ok && json.status === "success", provider, status: res.status, message: json.message };
    }
    if (provider === "hubtel") {
      const id = process.env.HUBTEL_CLIENT_ID ?? process.env.SMS_API_KEY?.split(":")[0];
      const secret = process.env.HUBTEL_CLIENT_SECRET ?? process.env.SMS_API_KEY?.split(":")[1];
      if (!id || !secret) return { ok: false, provider, error: "HUBTEL_CLIENT_ID/HUBTEL_CLIENT_SECRET not set" };
      const url = new URL("https://smsc.hubtel.com/v1/messages/send");
      url.search = new URLSearchParams({ clientid: id, clientsecret: secret, from: sender, to, content: message }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const json = (await res.json().catch(() => ({}))) as { messageId?: string; status?: number };
      return { ok: res.ok, provider, status: res.status, id: json.messageId };
    }
    log.info("sms.log", { to: mask(to), length: message.length, message: process.env.NODE_ENV === "production" ? undefined : message });
    return { ok: true, provider: "log" };
  } catch (err) {
    log.warn("sms.error", { provider, err });
    return { ok: false, provider, error: "network" };
  }
}

// ---------------------------------------------------------------------------
// Push (Expo Push API)
// ---------------------------------------------------------------------------
interface ExpoMessage {
  to: string;
  title: string;
  body?: string;
  sound?: "default";
  channelId?: string;
  priority?: "default" | "normal" | "high";
  data?: Record<string, unknown>;
}
type ExpoTicket = { status: "ok"; id: string } | { status: "error"; message: string; details?: { error?: string } };

async function sendExpoPush(svc: Svc, items: { notificationId: string; token: string; message: ExpoMessage }[]) {
  const out = new Map<string, { sent: number; failed: number; errors?: string[] }>();
  const dead = new Set<string>();
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    let tickets: ExpoTicket[] = [];
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers,
        body: JSON.stringify(batch.map((b) => b.message)),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: { message: string }[] };
      tickets = json.data ?? batch.map(() => ({ status: "error" as const, message: json.errors?.[0]?.message ?? `HTTP ${res.status}` }));
    } catch (err) {
      log.warn("push.error", { err });
      tickets = batch.map(() => ({ status: "error" as const, message: "network" }));
    }
    batch.forEach((b, idx) => {
      const t = tickets[idx];
      const r = out.get(b.notificationId) ?? { sent: 0, failed: 0 };
      if (t?.status === "ok") r.sent++;
      else {
        r.failed++;
        const code = t && t.status === "error" ? (t.details?.error ?? t.message) : "unknown";
        (r.errors ??= []).push(code);
        if (code === "DeviceNotRegistered") dead.add(b.token);
      }
      out.set(b.notificationId, r);
    });
  }
  if (dead.size) {
    await svc.from("device_tokens").delete().in("token", [...dead]);
    log.info("push.tokens_removed", { count: dead.size });
  }
  return out;
}
