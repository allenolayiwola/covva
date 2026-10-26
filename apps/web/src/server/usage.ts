import "server-only";
import { createHash } from "node:crypto";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

type Svc = ReturnType<typeof createServiceClient>;

/** `YYYY-MM` in UTC. */
export function period(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

/**
 * Deterministic UUID for "this policy in this month", so `usage_events`' unique
 * (org_id, metric, reference_id) makes `policy_active` idempotent per month.
 * The policy id and period are also stored in `usage_events.details`.
 */
export function monthlyReference(policyId: string, month = period()): string {
  const h = createHash("sha256").update(`policy_active:${policyId}:${month}`).digest("hex");
  // Format as an RFC 4122 v5-style UUID.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** Record a billable policy-month for the broker (falls back to the insurer for direct business). */
export async function recordPolicyActive(svc: Svc, policy: { id: string; broker_org_id: string | null; insurer_org_id: string }, month = period()) {
  const orgId = policy.broker_org_id ?? policy.insurer_org_id;
  const row = { org_id: orgId, metric: "policy_active", quantity: 1, reference_id: monthlyReference(policy.id, month) };
  // `details` is added by migration 20261026130000_backend_support (cast until types are regenerated).
  const withDetails = { ...row, details: { policy_id: policy.id, period: month } as Json } as unknown as typeof row;
  let { error } = await svc.from("usage_events").upsert(withDetails, { onConflict: "org_id,metric,reference_id", ignoreDuplicates: true });
  if (error?.code === "PGRST204" || error?.code === "42703") {
    ({ error } = await svc.from("usage_events").upsert(row, { onConflict: "org_id,metric,reference_id", ignoreDuplicates: true }));
  }
  if (error) log.warn("usage.policy_active_failed", { policyId: policy.id, err: error });
}
