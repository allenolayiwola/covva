import "server-only";
import { compareQuotes } from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { notify, notifyOrg } from "@/server/notify";
import { recordPolicyActive, period } from "@/server/usage";
import { toComparable, type QuoteWithParties } from "@/server/quotes";
import { log } from "@/server/log";
import { retryDueDeliveries } from "@/server/webhooks";

/**
 * Scheduled jobs (Vercel Cron → /api/cron/<job>). All use the service client: they are
 * system actions across every customer and organisation, which RLS intentionally blocks.
 * Each job is idempotent so a retried or overlapping run is harmless.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type CronJob = (svc: Svc) => Promise<Record<string, unknown>>;

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

async function setting<T>(svc: Svc, key: string, fallback: T): Promise<T> {
  const { data } = await svc.from("platform_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

// ---------------------------------------------------------------------------
const renewalReminders: CronJob = async (svc) => {
  const thresholds = (await setting<number[]>(svc, "renewal_reminder_days", [45, 30, 14, 7, 1])).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  if (!thresholds.length) return { sent: 0 };
  const max = thresholds[thresholds.length - 1]!;
  const t = today();
  const { data: policies } = await svc
    .from("policies")
    .select("id, internal_reference, policy_number, customer_id, broker_org_id, cover_end, renewal_reminders_sent, category:product_categories(name)")
    .eq("status", "active")
    .eq("external_source", false)
    .gte("cover_end", t)
    .lte("cover_end", addDays(t, max))
    .limit(2000);
  let sent = 0;
  for (const p of policies ?? []) {
    const days = daysBetween(t, p.cover_end!);
    const threshold = thresholds.find((x) => x >= days);
    if (threshold === undefined) continue;
    const already = (Array.isArray(p.renewal_reminders_sent) ? p.renewal_reminders_sent : []).map((x) =>
      typeof x === "number" ? x : Number((x as { threshold?: number } | null)?.threshold),
    );
    if (already.includes(threshold)) continue;
    // Record before sending so a retried run doesn't double-send (the job runs once a day).
    const prev = Array.isArray(p.renewal_reminders_sent) ? (p.renewal_reminders_sent as Json[]) : [];
    const next = [...prev, { threshold, sent_at: new Date().toISOString() }];
    const { error } = await svc.from("policies").update({ renewal_reminders_sent: next as Json }).eq("id", p.id);
    if (error) {
      log.warn("cron.renewal_record_failed", { policyId: p.id, err: error });
      continue;
    }
    const name = (p.category as unknown as { name: string } | null)?.name ?? "Your";
    const when = days <= 1 ? "tomorrow" : `in ${days} days`;
    await notify({
      userId: p.customer_id,
      kind: "renewal.reminder",
      title: `${name} cover ends ${when}`,
      body: `Policy ${p.policy_number ?? p.internal_reference} ends on ${p.cover_end}. Review what has changed and ask your broker about renewal. Any renewal price is an estimate until the insurer confirms it.`,
      link: `/account/policies/${p.id}`,
      data: { policy_id: p.id, days },
    });
    if (p.broker_org_id) {
      await notifyOrg(p.broker_org_id, {
        kind: "renewal.due",
        title: `Renewal due ${when}: ${p.policy_number ?? p.internal_reference}`,
        link: `/partner/renewals`,
        data: { policy_id: p.id, days },
        channels: ["in_app", "email"],
      });
    }
    sent++;
  }
  return { checked: policies?.length ?? 0, sent };
};

// ---------------------------------------------------------------------------
const SLA_STATUSES = ["submitted", "adviser_action", "insurer_response", "policy_documents"] as const;

const slaMonitor: CronJob = async (svc) => {
  const now = new Date().toISOString();
  const { data: overdue } = await svc
    .from("requests")
    .select("id, reference, title, status, broker_org_id, due_at")
    .in("status", [...SLA_STATUSES])
    .lt("due_at", now)
    .is("sla_breached_at", null)
    .limit(500);
  let breached = 0;
  for (const r of overdue ?? []) {
    const { data: claimed } = await svc.from("requests").update({ sla_breached_at: now }).eq("id", r.id).is("sla_breached_at", null).select("id");
    if (!claimed?.length) continue;
    breached++;
    await svc.from("request_events").insert({
      request_id: r.id,
      actor_party: "system",
      event: "sla_breached",
      note: `Service level missed (due ${r.due_at}).`,
      visible_to_customer: false,
      data: { due_at: r.due_at, status: r.status } as Json,
    });
    if (!r.broker_org_id) continue;
    // Escalate to named supervisors (is_supervisor) plus supervisor/admin/owner roles.
    const { data: sups } = await svc
      .from("memberships")
      .select("user_id, role, is_supervisor")
      .eq("org_id", r.broker_org_id)
      .eq("active", true);
    const userIds = [...new Set((sups ?? []).filter((m) => m.is_supervisor || ["supervisor", "admin", "owner"].includes(m.role)).map((m) => m.user_id))];
    if (userIds.length) {
      await notify(
        userIds.map((userId) => ({
          userId,
          kind: "request.sla_breached",
          title: `Overdue: ${r.reference}`,
          body: `${r.title ?? "Request"} is past its service level (${r.status.replace(/_/g, " ")}).`,
          link: `/partner/requests/${r.id}`,
          data: { request_id: r.id },
          channels: ["in_app", "email", "push"],
        })),
      );
    }
  }
  return { checked: overdue?.length ?? 0, breached };
};

// ---------------------------------------------------------------------------
const quoteExpiry: CronJob = async (svc) => {
  const now = new Date().toISOString();
  const { data: expiring } = await svc
    .from("quotes")
    .select("id, request_id")
    .eq("status", "ready_to_accept")
    .lt("valid_until", now)
    .limit(1000);
  if (!expiring?.length) return { expired: 0 };
  const requestIds = [...new Set(expiring.map((q) => q.request_id))];
  const expiredIds = new Set(expiring.map((q) => q.id));

  // Work out each request's top-ranked quote before expiring anything.
  const { data: allQuotes } = await svc
    .from("quotes")
    .select("*, insurer:organizations!quotes_insurer_org_id_fkey(id, name, slug, brand_color, logo_url, settings), product:products(id, name, tier)")
    .in("request_id", requestIds);
  const topByRequest = new Map<string, string | undefined>();
  for (const rid of requestIds) {
    const qs = ((allQuotes ?? []) as unknown as QuoteWithParties[]).filter((q) => q.request_id === rid);
    topByRequest.set(rid, compareQuotes(qs.map(toComparable)).ranked[0]?.quote.id);
  }

  const { error } = await svc.from("quotes").update({ status: "expired" }).in("id", [...expiredIds]).eq("status", "ready_to_accept");
  if (error) throw error;

  let notified = 0;
  const { data: requests } = await svc.from("requests").select("id, reference, customer_id, status").in("id", requestIds);
  for (const r of requests ?? []) {
    const top = topByRequest.get(r.id);
    if (!top || !expiredIds.has(top) || !["quotes_ready", "payment_confirmation"].includes(r.status)) continue;
    await notify({
      userId: r.customer_id,
      kind: "quote.expired",
      title: `A quote for ${r.reference} has expired`,
      body: "Binding quotes are only valid for a limited time. Ask your broker to revalidate it if you'd still like that option.",
      link: `/account/requests/${r.id}/quotes`,
      data: { request_id: r.id, quote_id: top },
    });
    notified++;
  }
  return { expired: expiredIds.size, notified };
};

// ---------------------------------------------------------------------------
const policyLifecycle: CronJob = async (svc) => {
  const t = today();
  const { data: ended } = await svc
    .from("policies")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("cover_end", t)
    .select("id, customer_id, policy_number, internal_reference, external_source");
  for (const p of ended ?? []) {
    if (p.external_source) continue;
    await notify({
      userId: p.customer_id,
      kind: "policy.expired",
      title: `Policy ${p.policy_number ?? p.internal_reference} has ended`,
      body: "You are no longer covered under this policy. Ask your broker if you'd like to arrange new cover.",
      link: `/account/policies/${p.id}`,
      data: { policy_id: p.id },
      channels: ["in_app", "push", "email"],
    });
  }
  return { expired: ended?.length ?? 0 };
};

// ---------------------------------------------------------------------------
const usageMetering: CronJob = async (svc) => {
  const month = period();
  let from = 0;
  let recorded = 0;
  for (;;) {
    const { data } = await svc
      .from("policies")
      .select("id, broker_org_id, insurer_org_id")
      .eq("status", "active")
      .eq("external_source", false)
      .order("id")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const p of data) {
      await recordPolicyActive(svc, p, month);
      recorded++;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return { period: month, policies: recorded };
};

// ---------------------------------------------------------------------------
const complaintSla: CronJob = async (svc) => {
  const now = new Date().toISOString();
  const { data: overdue } = await svc
    .from("complaints")
    .select("id, reference, subject, owner_org_id, due_at, status")
    .in("status", ["open", "acknowledged", "investigating"])
    .lt("due_at", now)
    .limit(500);
  const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
  let escalated = 0;
  for (const c of overdue ?? []) {
    const { count } = await svc.from("complaint_events").select("id", { count: "exact", head: true }).eq("complaint_id", c.id).like("note", "SLA breached%");
    if (count) continue;
    await svc.from("complaint_events").insert({ complaint_id: c.id, actor_party: "system", note: `SLA breached: resolution was due ${c.due_at}.` });
    const msg = {
      kind: "complaint.sla_breached",
      title: `Complaint overdue: ${c.reference}`,
      body: `"${c.subject}" has passed its resolution deadline.`,
      data: { complaint_id: c.id },
      channels: ["in_app", "email"] as ("in_app" | "email")[],
    };
    if (c.owner_org_id) await notifyOrg(c.owner_org_id, { ...msg, link: `/partner/complaints/${c.id}` }, ["owner", "admin", "supervisor"]);
    if (platform && platform.id !== c.owner_org_id) await notifyOrg(platform.id, { ...msg, link: `/complaints/${c.id}` }, ["platform_admin", "compliance", "platform_ops"]);
    escalated++;
  }
  return { checked: overdue?.length ?? 0, escalated };
};

// ---------------------------------------------------------------------------
/** Partner webhook retries: deliveries past `next_attempt_at` (backoff 1m, 5m, 30m, 2h, 12h; 5 attempts). */
const webhookRetry: CronJob = async (svc) => retryDueDeliveries(svc, 200);

export const CRON_JOBS: Record<string, CronJob> = {
  "renewal-reminders": renewalReminders,
  "sla-monitor": slaMonitor,
  "quote-expiry": quoteExpiry,
  "policy-lifecycle": policyLifecycle,
  "usage-metering": usageMetering,
  "complaint-sla": complaintSla,
  "webhook-retry": webhookRetry,
};

export async function runCron(job: string) {
  const fn = CRON_JOBS[job];
  if (!fn) return null;
  const svc = createServiceClient();
  const started = Date.now();
  let result: Record<string, unknown> = {};
  let ok = true;
  try {
    result = await fn(svc);
  } catch (err) {
    ok = false;
    log.error("cron.failed", { job, err });
    result = { error: err instanceof Error ? err.message : "failed" };
  }
  const ms = Date.now() - started;
  await svc
    .from("platform_settings")
    .upsert({ key: `cron_last_run:${job}`, value: { at: new Date().toISOString(), ok, ms, result } as unknown as Json, description: `Last run of the ${job} cron job` });
  log.info("cron.run", { job, ok, ms, result });
  return { job, ok, ms, result };
}
