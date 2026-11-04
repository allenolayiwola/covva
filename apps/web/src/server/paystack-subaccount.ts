import "server-only";
import { log } from "@/server/log";
import { paystack } from "@/server/providers/paystack";
import { subaccountProblem, type SubaccountInfo } from "@/server/paystack-subaccount-check";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; info: SubaccountInfo | null }>();

async function lookup(code: string): Promise<SubaccountInfo | null> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;
  const res = await paystack<SubaccountInfo>(`/subaccount/${encodeURIComponent(code)}`, { method: "GET" });
  if (!res.ok && res.status !== 404) throw new Error(`Paystack subaccount lookup failed (${res.status})`);
  const info = res.ok ? res.json.data ?? null : null;
  cache.set(code, { at: Date.now(), info });
  return info;
}

/**
 * Fails closed before any Paystack charge that settles to an insurer's subaccount: the subaccount must exist,
 * be active, settle in GHS and not send more than the agreed platform share to Covva's main account.
 * Returns an error message for the customer (null when safe).
 */
export async function subaccountBlocksPayment(code: string, allowedMainAccountPct: number, ctx: { insurerOrgId: string }): Promise<string | null> {
  let info: SubaccountInfo | null;
  try {
    info = await lookup(code);
  } catch (err) {
    log.error("paystack.subaccount_lookup_failed", { insurerOrgId: ctx.insurerOrgId, err });
    return "We couldn't confirm the insurer's payment route just now. No money has been taken. Please try again shortly.";
  }
  const problem = subaccountProblem(info, allowedMainAccountPct);
  if (!problem) return null;
  log.error("paystack.subaccount_unsafe", { insurerOrgId: ctx.insurerOrgId, problem });
  return "The insurer's payment route isn't set up correctly, so we can't take payment yet. No money has been taken. Our team has been alerted.";
}

/** Test hook: forget cached lookups. */
export function clearSubaccountCache() {
  cache.clear();
}
