import "server-only";
import { randomBytes } from "node:crypto";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError } from "@/server/requests";
import { log } from "@/server/log";

/**
 * Saved payment methods for sponsor subscriptions. Only PSP references are stored (Paystack
 * `customer_code` + `authorization_code`, Stripe customer + payment_method ids) plus the display
 * hints the PSP returns (brand, last4, expiry month/year, issuing country). Never a PAN or CVV.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type PaymentMethod = Row<"payment_methods">;

/** Fields safe to show to the account holder (no token references). */
export const PAYMENT_METHOD_PUBLIC = "id, psp, brand, last4, exp_month, exp_year, billing_country, currency, is_default, status, created_at";

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Was reuse requested at initiation (card saved for a subscription)? */
export function saveMethodRequested(payment: Pick<Row<"payments">, "raw_event">): boolean {
  const init = asObject(asObject(payment.raw_event).initialize);
  return init.save_method === true || !!init.sponsor_subscription;
}

/**
 * After a successful charge: keep the reusable authorisation the PSP returned, if the payer asked for
 * it. Paystack: `event.data.authorization { authorization_code, reusable, channel, brand, last4, … }`
 * and `event.data.customer.customer_code`. Simulator payments get a sandbox token so the sponsor
 * subscription flow can be exercised without a PSP. Returns the method id (or null).
 */
export async function savePaymentMethodFromOutcome(svc: Svc, payment: Row<"payments">, event: unknown): Promise<string | null> {
  if (!saveMethodRequested(payment)) return null;
  try {
    const data = asObject(asObject(event).data);
    const auth = asObject(data.authorization);
    const customer = asObject(data.customer);
    let row: Omit<Row<"payment_methods">, "id" | "created_at" | "updated_at" | "is_default" | "status"> | null = null;
    if (payment.provider === "simulator") {
      row = { user_id: payment.customer_id, psp: "simulator", provider_customer_ref: null, provider_token_ref: `SIM-${randomBytes(6).toString("hex").toUpperCase()}`, brand: "Sandbox card", last4: "4242", exp_month: 12, exp_year: new Date().getUTCFullYear() + 3, billing_country: payment.display_currency === "GBP" ? "GB" : payment.display_currency === "USD" ? "US" : payment.display_currency === "EUR" ? "DE" : payment.display_currency === "CAD" ? "CA" : "GH", currency: payment.display_currency ?? "GHS" };
    } else if (payment.provider === "paystack" && typeof auth.authorization_code === "string" && auth.reusable === true && (auth.channel === "card" || payment.channel === "card")) {
      row = {
        user_id: payment.customer_id,
        psp: payment.psp === "paystack_intl" ? "paystack_intl" : "paystack",
        provider_customer_ref: typeof customer.customer_code === "string" ? customer.customer_code : null,
        provider_token_ref: auth.authorization_code,
        brand: typeof auth.brand === "string" ? auth.brand.slice(0, 40) : typeof auth.card_type === "string" ? auth.card_type.slice(0, 40) : null,
        last4: typeof auth.last4 === "string" && /^\d{4}$/.test(auth.last4) ? auth.last4 : null,
        exp_month: Number(auth.exp_month) || null,
        exp_year: Number(auth.exp_year) || null,
        billing_country: typeof auth.country_code === "string" ? auth.country_code.slice(0, 2).toUpperCase() : null,
        currency: payment.display_currency ?? "GHS",
      };
    }
    if (!row) return null;
    const { count } = await svc.from("payment_methods").select("id", { count: "exact", head: true }).eq("user_id", payment.customer_id).eq("status", "active");
    const { data, error } = await svc
      .from("payment_methods")
      .upsert({ ...row, is_default: !count, status: "active" }, { onConflict: "user_id,psp,provider_token_ref" })
      .select("id")
      .single();
    if (error) {
      log.warn("payment_methods.save_failed", { paymentId: payment.id, err: error });
      return null;
    }
    await svc.from("payments").update({ raw_event: { ...asObject(payment.raw_event), payment_method_id: data.id } as Json }).eq("id", payment.id);
    return data.id;
  } catch (err) {
    log.warn("payment_methods.save_threw", { paymentId: payment.id, err });
    return null;
  }
}

/** The sponsor's usable method: the requested one (must be theirs and active) or their default. */
export async function resolvePaymentMethod(svc: Svc, userId: string, paymentMethodId?: string | null): Promise<PaymentMethod | null> {
  let q = svc.from("payment_methods").select("*").eq("user_id", userId).eq("status", "active");
  q = paymentMethodId ? q.eq("id", paymentMethodId) : q.order("is_default", { ascending: false }).order("created_at", { ascending: false });
  const { data } = await q.limit(1).maybeSingle();
  if (paymentMethodId && !data) throw new BusinessRuleError("That payment method isn't available. Choose another saved card.", "not_found");
  return data ?? null;
}

export async function setDefaultPaymentMethod(userId: string, id: string): Promise<void> {
  const svc = createServiceClient();
  const { data } = await svc.from("payment_methods").select("id").eq("id", id).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!data) throw new BusinessRuleError("Payment method not found.", "not_found");
  await svc.from("payment_methods").update({ is_default: false }).eq("user_id", userId).neq("id", id);
  await svc.from("payment_methods").update({ is_default: true }).eq("id", id);
}

/** Revoke (never delete) a saved method. Active subscriptions that use it are moved to past_due so the sponsor re-cards them. */
export async function revokePaymentMethod(userId: string, id: string): Promise<{ affectedSubscriptions: number }> {
  const svc = createServiceClient();
  const { data } = await svc.from("payment_methods").select("id, status").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new BusinessRuleError("Payment method not found.", "not_found");
  if (data.status === "revoked") return { affectedSubscriptions: 0 };
  await svc.from("payment_methods").update({ status: "revoked", is_default: false }).eq("id", id);
  const { data: subs } = await svc
    .from("sponsor_subscriptions")
    .update({ payment_method_id: null, status: "past_due", past_due_since: new Date().toISOString() })
    .eq("payment_method_id", id)
    .in("status", ["active", "past_due"])
    .select("id");
  return { affectedSubscriptions: subs?.length ?? 0 };
}
