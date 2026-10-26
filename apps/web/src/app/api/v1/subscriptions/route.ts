import { CreateSubscriptionInput, subscriptionSummary } from "@im/core";
import { parseJson, withApi } from "@/server/api-auth";
import { PAYMENT_METHOD_PUBLIC } from "@/server/payment-methods";
import { SUBSCRIPTION_PUBLIC, createSponsorSubscription } from "@/server/subscriptions";

/** GET /api/v1/subscriptions — the caller's sponsor subscriptions plus their saved payment methods (no card numbers). */
export const GET = withApi(
  async ({ auth }) => {
    const [subs, methods] = await Promise.all([
      auth.supabase.from("sponsor_subscriptions").select(SUBSCRIPTION_PUBLIC).eq("sponsor_user_id", auth.userId).order("created_at", { ascending: false }).limit(100),
      auth.supabase.from("payment_methods").select(PAYMENT_METHOD_PUBLIC).eq("user_id", auth.userId).neq("status", "revoked").order("is_default", { ascending: false }).limit(20),
    ]);
    return {
      items: (subs.data ?? []).map((s) => ({ ...s, summary: subscriptionSummary(s) })),
      paymentMethods: methods.data ?? [],
    };
  },
  { auth: "user" },
);

/**
 * POST /api/v1/subscriptions — start recurring collections for a policy the caller pays for.
 * Each collection is a GHS premium payment to the insurer charged to the saved card; the foreign
 * amount shown is indicative.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, CreateSubscriptionInput);
    const sub = await createSponsorSubscription({
      sponsorUserId: auth.userId,
      policyId: input.policyId,
      applicationId: input.applicationId,
      cadence: input.cadence,
      displayCurrency: input.displayCurrency,
      paymentMethodId: input.paymentMethodId,
      beneficiaryId: input.beneficiaryId,
    });
    return Response.json({ ok: true, data: { ...sub, summary: subscriptionSummary(sub) } }, { status: 201 });
  },
  { auth: "user" },
);
