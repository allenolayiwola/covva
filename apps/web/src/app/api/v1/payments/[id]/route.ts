import { PAYMENT_STATUS, POLICY_STATUS } from "@im/core";
import { must, uuidParam, withApi } from "@/server/api-auth";
import { verifyPayment } from "@/server/payments";
import { log } from "@/server/log";

const SELECT = "id, status, amount, currency, channel, provider, provider_reference, authorization_url, paid_at, failure_reason, request_id, policy_id, created_at, updated_at";

/** GET /api/v1/payments/{id} — poll a payment. Pending Paystack payments are re-verified with the provider. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/payments/[id]">) => {
    const id = uuidParam((await route.params).id);
    let payment = must(await auth.supabase.from("payments").select(SELECT).eq("id", id).maybeSingle(), "Payment not found.");
    if ((payment.status === "pending" || payment.status === "processing") && payment.provider === "paystack" && payment.provider_reference && Date.now() - new Date(payment.updated_at).getTime() > 5_000) {
      try {
        await verifyPayment(payment.provider_reference);
        payment = must(await auth.supabase.from("payments").select(SELECT).eq("id", id).maybeSingle(), "Payment not found.");
      } catch (err) {
        log.warn("payment.poll_verify_failed", { paymentId: id, err });
      }
    }
    let policy: { id: string; status: keyof typeof POLICY_STATUS; internal_reference: string; policy_number: string | null } | null = null;
    if (payment.policy_id) {
      const { data } = await auth.supabase.from("policies").select("id, status, internal_reference, policy_number").eq("id", payment.policy_id).maybeSingle();
      policy = data;
    }
    return {
      payment: { ...payment, statusLabel: PAYMENT_STATUS[payment.status].label },
      policy: policy ? { ...policy, statusLabel: POLICY_STATUS[policy.status].label, statusHint: POLICY_STATUS[policy.status].customerHint ?? null } : null,
      coverActive: policy?.status === "active",
      message:
        payment.status === "succeeded"
          ? "Payment received. Your cover starts once the insurer confirms acceptance and issues documents."
          : payment.status === "failed" || payment.status === "abandoned"
            ? "Your payment was not completed. You can try again."
            : "Waiting for the payment provider to confirm your payment.",
      final: !["pending", "processing"].includes(payment.status),
    };
  },
  { auth: "user" },
);
