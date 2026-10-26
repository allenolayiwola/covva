import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";
import { WEBHOOK_BACKOFF_MINUTES, WEBHOOK_MAX_ATTEMPTS, type WebhookEvent } from "@/server/webhook-events";

export { WEBHOOK_EVENTS, type WebhookEvent } from "@/server/webhook-events";

/**
 * Partner webhook dispatcher (owner: Backend stream).
 *
 * `emitEvent(orgId, event, payload)` records one `webhook_deliveries` row per active
 * endpoint of the organisation subscribed to the event (or `*`) and attempts delivery
 * straight away. Failed deliveries are retried by the `webhook-retry` cron job with
 * exponential backoff (1m, 5m, 30m, 2h, 12h — five attempts in total).
 *
 * Uses the service client: deliveries are system writes (no insert policy for users)
 * and the dispatcher runs from request handlers acting for other parties, cron and
 * webhooks. Payloads must contain ids, references and statuses only — never names,
 * contact details or risk data.
 */
type Svc = ReturnType<typeof createServiceClient>;
type Endpoint = Pick<Row<"webhook_endpoints">, "id" | "org_id" | "url" | "secret" | "events" | "active">;
type Delivery = Pick<Row<"webhook_deliveries">, "id" | "endpoint_id" | "event" | "payload" | "attempts" | "created_at">;

export type WebhookPayload = Record<string, string | number | boolean | null | undefined>;

const TIMEOUT_MS = 10_000;
const USER_AGENT = "Covva-Webhooks/1.0 (+https://covva.com.gh/docs/webhooks)";

function svcOrNull(): Svc | null {
  try {
    return createServiceClient();
  } catch {
    log.warn("webhooks.unconfigured");
    return null;
  }
}

/** Run after the response when inside a request; otherwise run now. */
function defer(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
    return Promise.resolve();
  } catch {
    return task();
  }
}

/** HMAC-SHA256 hex of `${timestamp}.${body}` with the endpoint secret. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Only https endpoints to public hosts are called. */
function safeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return process.env.NODE_ENV !== "production" && u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) && !/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname);
  } catch {
    return false;
  }
}

function nextAttemptAt(attempts: number): string | null {
  const minutes = WEBHOOK_BACKOFF_MINUTES[attempts - 1];
  if (attempts >= WEBHOOK_MAX_ATTEMPTS || minutes === undefined) return null;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Queue an event for every subscribed, active endpoint of `orgId` and try to deliver
 * it now. Safe to call with a null/undefined org (no-op) and when the service key is
 * missing (logged, no-op). Never throws.
 */
export async function emitEvent(
  orgId: string | null | undefined,
  event: WebhookEvent,
  payload: WebhookPayload,
  opts: { endpointId?: string } = {},
): Promise<{ queued: number }> {
  if (!orgId) return { queued: 0 };
  const svc = svcOrNull();
  if (!svc) return { queued: 0 };
  try {
    let q = svc.from("webhook_endpoints").select("id, org_id, url, secret, events, active").eq("org_id", orgId).eq("active", true);
    if (opts.endpointId) q = q.eq("id", opts.endpointId);
    const { data: endpoints } = await q;
    const targets = (endpoints ?? []).filter((e) => opts.endpointId || e.events.includes(event) || e.events.includes("*"));
    if (!targets.length) return { queued: 0 };

    const now = new Date().toISOString();
    const { data: rows, error } = await svc
      .from("webhook_deliveries")
      .insert(targets.map((e) => ({ endpoint_id: e.id, event, payload: payload as Json, attempts: 0, next_attempt_at: now })))
      .select("id, endpoint_id, event, payload, attempts, created_at");
    if (error || !rows) {
      log.error("webhooks.queue_failed", { orgId, event, err: error });
      return { queued: 0 };
    }
    const byEndpoint = new Map(targets.map((e) => [e.id, e]));
    await defer(async () => {
      for (const d of rows) {
        const ep = byEndpoint.get(d.endpoint_id);
        if (ep) await deliver(svc, ep, d);
      }
    });
    return { queued: rows.length };
  } catch (err) {
    log.error("webhooks.emit_failed", { orgId, event, err });
    return { queued: 0 };
  }
}

/** Convenience for the common "status changed" shape. */
export async function emitRequestStatus(orgId: string | null | undefined, req: { id: string; reference: string }, from: string | null, to: string) {
  await emitEvent(orgId, "request.status_changed", { request_id: req.id, reference: req.reference, from_status: from, status: to });
}

/** One delivery attempt: POST signed JSON, record the outcome and schedule a retry if needed. */
export async function deliver(svc: Svc, endpoint: Endpoint, delivery: Delivery): Promise<{ ok: boolean; status: number | null }> {
  const attempts = delivery.attempts + 1;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    id: String(delivery.id),
    event: delivery.event,
    created_at: delivery.created_at,
    attempt: attempts,
    org_id: endpoint.org_id,
    data: delivery.payload,
  });
  const headers = {
    "content-type": "application/json",
    "user-agent": USER_AGENT,
    "x-covva-event": delivery.event,
    "x-covva-delivery": String(delivery.id),
    "x-covva-timestamp": timestamp,
    "x-covva-signature": signWebhook(endpoint.secret, timestamp, body),
  };

  let status: number | null = null;
  let lastError: string | null = null;
  const started = Date.now();
  if (!safeUrl(endpoint.url)) {
    lastError = "Endpoint URL must be a public https:// address";
  } else {
    try {
      const res = await fetch(endpoint.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      status = res.status;
      if (!(res.status >= 200 && res.status < 300)) lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? (err.name === "TimeoutError" ? "Timed out after 10 s" : err.message.slice(0, 200)) : "Network error";
    }
  }
  const ms = Date.now() - started;
  const ok = status !== null && status >= 200 && status < 300;
  const retryAt = ok ? null : nextAttemptAt(attempts);

  await svc
    .from("webhook_deliveries")
    .update({
      status,
      attempts,
      response_ms: ms,
      last_error: ok ? null : lastError,
      delivered_at: ok ? new Date().toISOString() : null,
      next_attempt_at: retryAt,
    })
    .eq("id", delivery.id);
  await svc.from("webhook_endpoints").update({ last_delivery_at: new Date().toISOString(), last_status: status }).eq("id", endpoint.id);

  if (ok) log.info("webhooks.delivered", { deliveryId: delivery.id, event: delivery.event, status, ms });
  else log.warn("webhooks.delivery_failed", { deliveryId: delivery.id, event: delivery.event, status, attempts, retryAt, error: lastError });
  return { ok, status };
}

/** Cron: retry deliveries whose `next_attempt_at` has passed (max 5 attempts). */
export async function retryDueDeliveries(svc: Svc, limit = 100): Promise<{ checked: number; delivered: number; failed: number }> {
  const now = new Date().toISOString();
  const { data: due } = await svc
    .from("webhook_deliveries")
    .select("id, endpoint_id, event, payload, attempts, created_at, endpoint:webhook_endpoints!webhook_deliveries_endpoint_id_fkey(id, org_id, url, secret, events, active)")
    .is("delivered_at", null)
    .lte("next_attempt_at", now)
    .lt("attempts", WEBHOOK_MAX_ATTEMPTS)
    .order("next_attempt_at")
    .limit(limit);
  let delivered = 0;
  let failed = 0;
  for (const d of due ?? []) {
    const ep = d.endpoint as unknown as Endpoint | null;
    if (!ep || !ep.active) {
      // Endpoint paused or deleted: stop retrying.
      await svc.from("webhook_deliveries").update({ next_attempt_at: null, last_error: "Endpoint paused" }).eq("id", d.id);
      continue;
    }
    const r = await deliver(svc, ep, d);
    if (r.ok) delivered++;
    else failed++;
  }
  return { checked: due?.length ?? 0, delivered, failed };
}
