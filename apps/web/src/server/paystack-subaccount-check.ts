/**
 * Pure check for an insurer's Paystack subaccount (see server/paystack-subaccount.ts). Paystack sends a
 * subaccount's `percentage_charge` of every transaction to Covva's main account, so a subaccount set to, say,
 * 25% would route a quarter of each premium to Covva, which must never hold premiums. Only the platform fee
 * agreed in the commercial terms may go to the main account.
 */
export interface SubaccountInfo {
  subaccount_code?: string;
  active?: boolean | number | null;
  currency?: string | null;
  percentage_charge?: number | string | null;
}

/** Returns why this subaccount must not take the payment, or null when it is safe. */
export function subaccountProblem(sub: SubaccountInfo | null | undefined, allowedMainAccountPct: number): string | null {
  if (!sub) return "subaccount not found on Paystack";
  if (sub.active === false || sub.active === 0) return "subaccount is inactive on Paystack";
  if (sub.currency && sub.currency.toUpperCase() !== "GHS") return `subaccount settles in ${sub.currency}, not GHS`;
  const pct = Number(sub.percentage_charge ?? 0);
  if (!Number.isFinite(pct)) return "subaccount percentage charge is unreadable";
  const allowed = Math.max(0, allowedMainAccountPct);
  if (pct > allowed + 0.001) {
    return `subaccount sends ${pct}% of each payment to Covva's main account; at most ${Math.round(allowed * 100) / 100}% is allowed`;
  }
  return null;
}
