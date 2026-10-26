import "server-only";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { emailHtml, emailText, sendEmail } from "@/server/email";

/**
 * In-app (+ optional email) notifications written from the admin console.
 * Uses the service client: notification rows are system writes for *other*
 * users, which RLS deliberately does not allow from a staff session. The web
 * app's richer fan-out (SMS/push) lives in apps/web/src/server/notify.ts; the
 * admin only ever notifies staff and partners by in-app row and email.
 */
export interface StaffNotification {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  /** Absolute URL (admin console pages are on a different host than the web app). */
  link?: string;
  data?: Record<string, unknown>;
  email?: boolean;
}

export async function notifyUsers(input: StaffNotification | StaffNotification[]): Promise<{ inserted: number; emailed: number }> {
  const items = (Array.isArray(input) ? input : [input]).filter((i) => i.userId && i.title);
  if (!items.length) return { inserted: 0, emailed: 0 };
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    console.warn(JSON.stringify({ level: "warn", msg: "notify.unconfigured", service: "admin" }));
    return { inserted: 0, emailed: 0 };
  }
  const rows = items.map((i) => ({
    user_id: i.userId,
    kind: i.kind,
    title: i.title.slice(0, 200),
    body: i.body?.slice(0, 2000) ?? null,
    link: i.link ?? null,
    data: (i.data ?? {}) as Json,
    channels: i.email ? ["in_app", "email"] : ["in_app"],
  }));
  const { data: inserted, error } = await svc.from("notifications").insert(rows).select("id, user_id, title, body, link, channels");
  if (error || !inserted) {
    console.error(JSON.stringify({ level: "error", msg: "notify.insert_failed", service: "admin", error: error?.message }));
    return { inserted: 0, emailed: 0 };
  }
  const emailIds = [...new Set(inserted.filter((n) => n.channels.includes("email")).map((n) => n.user_id))];
  let emailed = 0;
  if (emailIds.length) {
    const { data: profiles } = await svc.from("profiles").select("id, email, full_name, preferred_name, notification_prefs").in("id", emailIds);
    const byUser = new Map((profiles ?? []).map((p) => [p.id, p]));
    for (const n of inserted) {
      if (!n.channels.includes("email")) continue;
      const p = byUser.get(n.user_id);
      const prefs = (p?.notification_prefs ?? {}) as { email?: boolean };
      let delivered: Json;
      if (prefs.email === false) delivered = { skipped: "opted_out" };
      else if (!p?.email) delivered = { skipped: "no_address" };
      else {
        const content = { title: n.title, body: n.body, link: n.link, name: p.preferred_name || p.full_name };
        delivered = (await sendEmail({ to: p.email, subject: n.title, html: emailHtml(content), text: emailText(content) })) as unknown as Json;
        emailed++;
      }
      await svc.from("notifications").update({ delivered: { in_app: true, email: delivered } as Json }).eq("id", n.id);
    }
  }
  return { inserted: inserted.length, emailed };
}
