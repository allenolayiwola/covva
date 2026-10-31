import 'server-only';
import type { PaymentMode } from '@im/core';
/** Fetch the web deployment's mode: admin env does not contain payment credentials. */
export async function paymentMode(): Promise<PaymentMode | 'Unavailable'> {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.PAYMENTS_MODE_SECRET;
  if (!site || !secret) return 'Unavailable';
  try {
    const res = await fetch(new URL('/api/payments/mode', site), {
      headers: { 'x-payments-mode-secret': secret }, cache: 'no-store', signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return 'Unavailable';
    const result = await res.json() as { data?: { mode?: PaymentMode } };
    const mode = result.data?.mode;
    return mode && ['Simulator', 'Test', 'Live'].includes(mode) ? mode : 'Unavailable';
  } catch { return 'Unavailable'; }
}
