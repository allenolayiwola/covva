import "server-only";
import type { Row } from "@im/db";
import { HOUR, type Supabase } from "@/lib/query";

export type ExceptionKind = "no_policy_48h" | "failed" | "amount_mismatch";
export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  no_policy_48h: "Confirmed > 48h, no policy",
  failed: "Failed / reversed",
  amount_mismatch: "Amount ≠ quote",
};

export type PaymentRow = Pick<
  Row<"payments">,
  | "id" | "amount" | "currency" | "status" | "paid_at" | "created_at" | "policy_id" | "request_id" | "quote_id" | "payee_org_id"
  | "provider" | "provider_reference" | "channel" | "reconciled" | "reconciled_at" | "failure_reason" | "customer_id"
>;

export const PAYMENT_COLUMNS =
  "id, amount, currency, status, paid_at, created_at, policy_id, request_id, quote_id, payee_org_id, provider, provider_reference, channel, reconciled, reconciled_at, failure_reason, customer_id";

/**
 * Reconciliation exceptions among UNRECONCILED payments (marking a payment
 * reconciled resolves its exception):
 *  - succeeded more than 48h ago but no policy exists for the request
 *  - failed or reversed
 *  - amount differs from the quote premium (and from premium + taxes + fees)
 */
export async function findPaymentExceptions(supabase: Supabase, limit = 1000) {
  const { data: payments } = await supabase
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("reconciled", false)
    .in("status", ["succeeded", "failed", "reversed"])
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (payments ?? []) as PaymentRow[];
  if (!rows.length) return [] as { payment: PaymentRow; kinds: ExceptionKind[]; expected: number | null }[];

  const quoteIds = [...new Set(rows.map((p) => p.quote_id).filter((x): x is string => !!x))];
  const requestIds = [...new Set(rows.map((p) => p.request_id))];
  const [{ data: quotes }, { data: policies }] = await Promise.all([
    quoteIds.length
      ? supabase.from("quotes").select("id, premium, taxes, fees").in("id", quoteIds.slice(0, 300))
      : Promise.resolve({ data: [] as { id: string; premium: number; taxes: number; fees: number }[] }),
    supabase.from("policies").select("id, request_id").in("request_id", requestIds.slice(0, 300)),
  ]);
  const quoteMap = new Map((quotes ?? []).map((q) => [q.id, q]));
  const requestsWithPolicy = new Set((policies ?? []).map((p) => p.request_id));
  const now = Date.now();

  const out: { payment: PaymentRow; kinds: ExceptionKind[]; expected: number | null }[] = [];
  for (const p of rows) {
    const kinds: ExceptionKind[] = [];
    const q = p.quote_id ? quoteMap.get(p.quote_id) : undefined;
    const expected = q ? Number(q.premium) : null;
    if (p.status === "failed" || p.status === "reversed") kinds.push("failed");
    if (p.status === "succeeded") {
      const paidAt = new Date(p.paid_at ?? p.created_at).getTime();
      if (!p.policy_id && !requestsWithPolicy.has(p.request_id) && now - paidAt > 48 * HOUR) kinds.push("no_policy_48h");
      if (q) {
        const total = Number(q.premium) + Number(q.taxes ?? 0) + Number(q.fees ?? 0);
        const amt = Number(p.amount);
        if (Math.abs(amt - Number(q.premium)) > 0.009 && Math.abs(amt - total) > 0.009) kinds.push("amount_mismatch");
      }
    }
    if (kinds.length) out.push({ payment: p, kinds, expected });
  }
  return out;
}
