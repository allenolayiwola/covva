import { CLAIM_DISCLAIMER, CLAIM_STATUS, CLAIM_TIMELINE, buildClaimTimeline, nextExpectedStep } from "@im/core";
import { check, must, uuidParam, withApi } from "@/server/api-auth";

/**
 * GET /api/v1/claims/{id}/timeline — the customer-facing journey: reported → acknowledged (24 h) → assessment
 * (5 working days) → decision → payment (10 working days), with reached and expected dates, plus the raw events.
 */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/claims/[id]">) => {
    const id = uuidParam((await route.params).id);
    const claim = must(await auth.supabase.from("claims").select("id, reference, status, customer_id, reported_at, delivered_to_insurer_at, acknowledged_at, decision_at, paid_at, created_at").eq("id", id).maybeSingle(), "Claim not found.");
    let ev = auth.supabase.from("claim_events").select("id, from_status, to_status, note, actor_party, created_at").eq("claim_id", id).order("created_at");
    if (claim.customer_id === auth.userId) ev = ev.eq("visible_to_customer", true);
    const events = await ev;
    check(events);
    const now = new Date();
    const next = nextExpectedStep(claim, events.data ?? [], now);
    return {
      status: claim.status,
      statusLabel: CLAIM_STATUS[claim.status].label,
      stages: buildClaimTimeline(claim, events.data ?? [], now),
      next: { stage: next.stage?.key ?? null, label: next.stage?.label ?? null, expectedBy: next.expectedBy?.toISOString() ?? null, overdue: next.overdue, done: next.done, message: next.message },
      expectations: CLAIM_TIMELINE.map((s) => ({ key: s.key, label: s.label, expected: s.expectedLabel })),
      events: (events.data ?? []).map((e) => ({ ...e, toStatusLabel: e.to_status ? CLAIM_STATUS[e.to_status].label : null })),
      disclaimer: CLAIM_DISCLAIMER,
    };
  },
  { auth: "user" },
);
