import "server-only";
import { ROLE_STATEMENTS } from "@im/core";

/**
 * Minimal transactional email for the admin console (mirrors apps/web/src/server/notify.ts
 * sendEmail: Resend over HTTP, degrading to a log line when RESEND_API_KEY is unset).
 * Used for partner invitations from assisted onboarding and CRM task reminders.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type EmailResult = { ok: true; provider: "resend" | "log"; id?: string } | { ok: false; provider: "resend"; status?: number; error?: string };

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_ENV === "production" ? "https://covva.com.gh" : "http://localhost:3000")).replace(/\/$/, "");

export function maskEmail(value: string | null | undefined): string | null {
  if (!value || !value.includes("@")) return value ? "***" : null;
  const [u, d] = value.split("@");
  return `${u!.slice(0, 1)}***@${d}`;
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ level: "info", msg: "email.log", service: "admin", to: maskEmail(msg.to), subject: msg.subject, time: new Date().toISOString() }));
    return { ok: true, provider: "log" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Covva <no-reply@covva.com.gh>",
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      console.warn(JSON.stringify({ level: "warn", msg: "email.failed", service: "admin", status: res.status, message: json.message }));
      return { ok: false, provider: "resend", status: res.status, error: json.message };
    }
    return { ok: true, provider: "resend", id: json.id };
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "email.error", service: "admin", error: err instanceof Error ? err.message : String(err) }));
    return { ok: false, provider: "resend", error: "network" };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface EmailContent {
  title: string;
  body?: string | null;
  link?: string | null;
  cta?: string;
  name?: string | null;
}

/** Branded HTML matching the web app's notification template. `link` may be absolute or a web path. */
export function emailHtml(n: EmailContent): string {
  const href = n.link ? (/^https?:\/\//.test(n.link) ? n.link : `${siteUrl()}${n.link.startsWith("/") ? "" : "/"}${n.link}`) : null;
  const body = n.body ? escapeHtml(n.body).replace(/\n/g, "<br>") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(n.title)}</title></head>
<body style="margin:0;background:#F1F7F3;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#26434C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F7F3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #DCE3E1;border-radius:16px;overflow:hidden">
<tr><td style="background:#00796E;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.2px">
<img src="${siteUrl()}/brand/horizontal-reverse-light.png" height="36" alt="Covva" style="display:block;height:36px;border:0"></td></tr>
<tr><td style="padding:28px 24px 8px">
${n.name ? `<p style="margin:0 0 12px;font-size:15px">Hello ${escapeHtml(n.name)},</p>` : ""}
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#15343E">${escapeHtml(n.title)}</h1>
${body ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${body}</p>` : ""}
${href ? `<p style="margin:0 0 24px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#00796E;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:15px">${escapeHtml(n.cta ?? "View details")}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #DCE3E1;font-size:12px;line-height:1.6;color:#6F858C">
${escapeHtml(ROLE_STATEMENTS.platform)} ${escapeHtml(ROLE_STATEMENTS.payment)}
</td></tr></table></td></tr></table></body></html>`;
}

export function emailText(n: EmailContent): string {
  const href = n.link ? (/^https?:\/\//.test(n.link) ? n.link : `${siteUrl()}${n.link.startsWith("/") ? "" : "/"}${n.link}`) : null;
  return [n.title, "", n.body ?? "", href ? `\n${n.cta ?? "View details"}: ${href}` : "", "", "—", ROLE_STATEMENTS.platform].join("\n");
}
