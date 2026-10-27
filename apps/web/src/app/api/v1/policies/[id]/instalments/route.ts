import { instalmentProgressLine, parseInstalmentPlan, planRulesText, reinstatementAllowed } from "@im/core";
import { notFound, uuidParam, withApi } from "@/server/api-auth";
import { scheduleForPolicy } from "@/server/instalments";

/** GET /api/v1/policies/{id}/instalments — the policy's instalment schedule (null when paid in full). */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/policies/[id]/instalments">) => {
    const id = uuidParam((await route.params).id);
    // RLS: the caller must be able to see the policy (customer, sponsor, broker, insurer).
    const { data: policy } = await auth.supabase.from("policies").select("id").eq("id", id).maybeSingle();
    if (!policy) throw notFound("Policy not found.");
    const s = await scheduleForPolicy(id);
    if (!s) return { schedule: null };
    const plan = parseInstalmentPlan(s.plan);
    return {
      schedule: {
        id: s.id,
        policyId: s.policy_id,
        planKey: s.plan_key,
        status: s.status,
        currency: s.currency,
        totalAmount: Number(s.total_amount),
        instalmentCount: s.instalment_count,
        channel: s.channel,
        momoNetwork: s.momo_network,
        momoPhone: s.momo_phone,
        reinstatementReview: s.reinstatement_review,
        state: s.state,
        summary: instalmentProgressLine(s.state),
        rules: plan ? planRulesText(plan) : [],
        reinstatement: reinstatementAllowed(s),
        instalments: s.instalments.map((i) => ({ id: i.id, seq: i.seq, dueAt: i.due_at, amount: Number(i.amount), status: i.status, attempts: i.attempts, paidAt: i.paid_at })),
      },
    };
  },
  { auth: "user" },
);
