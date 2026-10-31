import 'server-only';
import { paystackKey } from '@/server/env';
import { verifyPaystackSignature } from './signatures';
import type { PaymentProvider } from './payment-provider';

/** Shared transport used by the legacy service API and the provider contract. */
export async function paystack<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ ok: boolean; status: number; json: { status?: boolean; message?: string; data?: T } }> {
  const key = paystackKey();
  if (!key) throw new Error('Paystack is not selected or configured.');
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({})) as { status?: boolean; message?: string; data?: T };
  return { ok: res.ok && json.status !== false, status: res.status, json };
}
export const paystackProvider: PaymentProvider = {
  name: 'paystack',
  settlement: ({ subaccount, splitCode }): Record<string, string> => {
    if (!subaccount.trim()) throw new Error('Paystack settlementAccount is required.');
    return splitCode ? { split_code: splitCode } : { subaccount, bearer: 'subaccount' };
  },
  async initialise(input) {
    const r = await paystack<{ authorization_url: string }>('/transaction/initialize', { method: 'POST', body: {
      reference: input.reference, amount: input.amountMinor, currency: input.currency, email: input.email,
      callback_url: input.callbackUrl, metadata: input.metadata,
      ...paystackProvider.settlement({ subaccount: input.settlementAccount, splitCode: input.splitCode }),
    } });
    if (!r.ok || !r.json.data?.authorization_url) throw new Error('Paystack checkout could not be started.');
    return { reference: input.reference, authorizationUrl: r.json.data.authorization_url };
  },
  async verify(reference) {
    const r = await paystack<{ status: string; amount: number; currency: string }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    const data = r.json.data;
    return { status: !r.ok || !data ? 'unknown' : data.status === 'success' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending', amountMinor: data?.amount, currency: data?.currency, raw: r.json };
  },
  async refund(reference, amountMinor) {
    const r = await paystack('/refund', { method: 'POST', body: { transaction: reference, amount: amountMinor } });
    if (!r.ok) throw new Error('Paystack refund could not be requested.');
    return { status: 'requested' };
  },
  verifyWebhook: (raw, signature) => verifyPaystackSignature(raw, signature, paystackKey()),
};
