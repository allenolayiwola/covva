import "server-only";
import { siteUrl } from "@/server/env";
import { unsupported, type PaymentProvider } from "./payment-provider";
import { paymentConfig } from "@/server/env";
import { verifyHubtelWebhook as checkSignature } from "./signatures";
import { log } from "@/server/log";

/**
 * Hubtel Online Checkout — the swappable second payment provider (Addendum 1; roadmap Phase 1).
 * Same shape as the Paystack calls in `server/payments.ts`: initiate a hosted checkout, verify a
 * transaction, authenticate a webhook. Selected with `PAYMENT_PROVIDER=hubtel` or per insurer via
 * `organizations.settings.payment_provider`.
 *
 *   HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET — API credentials (Basic auth)
 *   HUBTEL_MERCHANT_ACCOUNT               — merchant account number (POS sales id)
 *   HUBTEL_WEBHOOK_SECRET                 — shared secret the callback must present (`x-hubtel-secret`
 *                                           header or `?secret=`); Hubtel callbacks carry no HMAC, so
 *                                           every success is re-verified with the status API before
 *                                           it is applied.
 *
 * Settlement: Hubtel pays out to the merchant account's settlement bank account. To keep the
 * "premiums never touch Covva" rule, an insurer on Hubtel must have its OWN merchant account
 * (`organizations.settings.hubtel_merchant_account`), and the per-insurer account wins over the
 * global one. Without either, Hubtel checkout is refused for that insurer.
 */
export interface HubtelConfig {
  clientId: string;
  clientSecret: string;
  merchantAccount: string;
}

export interface HubtelInitiateInput {
  amount: number; // GHS
  description: string;
  clientReference: string;
  callbackUrl: string;
  returnUrl: string;
  cancellationUrl: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  merchantAccount?: string | null;
}

export interface HubtelInitiateResult {
  ok: boolean;
  checkoutUrl?: string;
  checkoutId?: string;
  message?: string;
  status: number;
}

export interface HubtelVerifyResult {
  ok: boolean;
  /** Paid | Unpaid | Refunded | Failed … normalised to our outcome. */
  status: "succeeded" | "failed" | "pending" | "refunded" | "unknown";
  amount?: number; // GHS
  transactionId?: string | null;
  paymentMethod?: string | null;
  paidAt?: string | null;
  raw?: unknown;
}

const CHECKOUT = "https://payproxyapi.hubtel.com/items/initiate";
const STATUS = "https://api-txnstatus.hubtel.com/transactions";

export function hubtelConfig(): HubtelConfig | null {
  if (paymentConfig().provider !== "hubtel") return null;
  const clientId = process.env.HUBTEL_CLIENT_ID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET;
  const merchantAccount = process.env.HUBTEL_MERCHANT_ACCOUNT ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, merchantAccount };
}

export const hubtelEnabled = () => hubtelConfig() !== null;

function basic(c: HubtelConfig) {
  return `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
}

/** Hubtel takes a 9-digit local number or 233… — normalise to 233XXXXXXXXX. */
export function hubtelPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return undefined;
}

/** POST /items/initiate → hosted checkout (cards, MoMo, bank, GhQR). */
export async function hubtelInitiate(input: HubtelInitiateInput, config = hubtelConfig()): Promise<HubtelInitiateResult> {
  if (!config) return { ok: false, status: 503, message: "Hubtel is not configured" };
  const merchant = input.merchantAccount || config.merchantAccount;
  if (!merchant) return { ok: false, status: 503, message: "No Hubtel merchant account for this insurer" };
  try {
    const res = await fetch(CHECKOUT, {
      method: "POST",
      headers: { Authorization: basic(config), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        totalAmount: Math.round(input.amount * 100) / 100,
        description: input.description.slice(0, 100),
        callbackUrl: input.callbackUrl,
        returnUrl: input.returnUrl,
        cancellationUrl: input.cancellationUrl,
        merchantAccountNumber: merchant,
        clientReference: input.clientReference,
        payeeMobileNumber: hubtelPhone(input.customerPhone),
        payeeEmail: input.customerEmail ?? undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { responseCode?: string; status?: string; message?: string; data?: { checkoutUrl?: string; checkoutId?: string; clientReference?: string } };
    const ok = res.ok && (json.responseCode === "0000" || json.status === "Success") && !!json.data?.checkoutUrl;
    if (!ok) log.warn("hubtel.initiate_failed", { status: res.status, code: json.responseCode, message: json.message });
    return { ok, status: res.status, checkoutUrl: json.data?.checkoutUrl, checkoutId: json.data?.checkoutId, message: json.message };
  } catch (err) {
    log.warn("hubtel.initiate_error", { err });
    return { ok: false, status: 0, message: "network" };
  }
}

function normaliseStatus(s: string | undefined): HubtelVerifyResult["status"] {
  const v = (s ?? "").toLowerCase();
  if (v === "paid" || v === "success" || v === "successful") return "succeeded";
  if (v === "unpaid" || v === "failed" || v === "cancelled" || v === "expired") return "failed";
  if (v === "refunded" || v === "reversed") return "refunded";
  if (v === "pending" || v === "processing") return "pending";
  return "unknown";
}

/** GET /transactions/{merchant}/status?clientReference= — the source of truth before applying a success. */
export async function hubtelVerify(clientReference: string, merchantAccount?: string | null, config = hubtelConfig()): Promise<HubtelVerifyResult> {
  if (!config) return { ok: false, status: "unknown" };
  const merchant = merchantAccount || config.merchantAccount;
  if (!merchant) return { ok: false, status: "unknown" };
  try {
    const res = await fetch(`${STATUS}/${encodeURIComponent(merchant)}/status?clientReference=${encodeURIComponent(clientReference)}`, {
      headers: { Authorization: basic(config), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { responseCode?: string; message?: string; data?: { status?: string; amount?: number; transactionId?: string; paymentMethod?: string; date?: string } };
    if (!res.ok || !json.data) {
      log.warn("hubtel.verify_failed", { status: res.status, code: json.responseCode, message: json.message });
      return { ok: false, status: "unknown", raw: json };
    }
    return {
      ok: true,
      status: normaliseStatus(json.data.status),
      amount: typeof json.data.amount === "number" && Number.isFinite(json.data.amount) ? json.data.amount : undefined,
      transactionId: json.data.transactionId ?? null,
      paymentMethod: json.data.paymentMethod ?? null,
      paidAt: json.data.date ?? null,
      raw: json,
    };
  } catch (err) {
    log.warn("hubtel.verify_error", { err });
    return { ok: false, status: "unknown" };
  }
}

/**
 * Hubtel callbacks are not signed. We require a shared secret (configured on the callback URL as
 * `?secret=` and/or sent as `x-hubtel-secret`) and then re-verify with the status API.
 */
export function verifyHubtelWebhook(provided: string | null | undefined, secret = process.env.HUBTEL_WEBHOOK_SECRET): boolean {
  return checkSignature(provided, secret);
}

/** Map a Hubtel callback body to our outcome (still re-verified before success is applied). */
export function parseHubtelCallback(body: unknown): { clientReference: string | null; status: HubtelVerifyResult["status"]; amount?: number; transactionId?: string | null; paymentMethod?: string | null } {
  const b = (body ?? {}) as { ResponseCode?: string; Status?: string; Data?: { ClientReference?: string; Amount?: number; TransactionId?: string; PaymentMethod?: string; Status?: string } };
  const d = b.Data ?? {};
  const status = b.ResponseCode === "0000" || normaliseStatus(d.Status ?? b.Status) === "succeeded" ? "succeeded" : normaliseStatus(d.Status ?? b.Status) === "unknown" ? "failed" : normaliseStatus(d.Status ?? b.Status);
  return { clientReference: d.ClientReference ?? null, status, amount: typeof d.Amount === "number" ? d.Amount : undefined, transactionId: d.TransactionId ?? null, paymentMethod: d.PaymentMethod ?? null };
}

/** Hubtel refunds/split provisioning require the merchant operations process. */
export const hubtelProvider: PaymentProvider = {
  name: 'hubtel',
  async initialise(input) {
    if (input.currency !== 'GHS') throw new Error('Hubtel requires GHS.');
    const r = await hubtelInitiate({ amount: input.amountMinor / 100, description: input.description, clientReference: input.reference,
      callbackUrl: `${siteUrl()}/api/webhooks/hubtel?secret=${encodeURIComponent(process.env.HUBTEL_WEBHOOK_SECRET ?? '')}`,
      returnUrl: input.callbackUrl, cancellationUrl: input.callbackUrl, customerEmail: input.email, merchantAccount: input.settlementAccount });
    if (!r.ok || !r.checkoutUrl) throw new Error('Hubtel checkout could not be started.');
    return { reference: input.reference, authorizationUrl: r.checkoutUrl };
  },
  async verify(reference, account) {
    const r = await hubtelVerify(reference, account);
    return { status: r.ok ? r.status : 'unknown', amountMinor: r.amount === undefined ? undefined : Math.round(r.amount * 100), currency: 'GHS', raw: r.raw };
  },
  async refund() { return unsupported('automated refunds'); },
  settlement: ({ subaccount }) => ({ merchantAccount: subaccount }),
  verifyWebhook: (_raw, signature) => hubtelEnabled() && verifyHubtelWebhook(signature),
};
