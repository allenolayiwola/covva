import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPaystackSignature(raw: string, signature: string | null, secret: string | null | undefined): boolean {
  if (!secret || !signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac('sha512', secret).update(raw).digest(), Buffer.from(signature, 'hex'));
}

export function verifyStripeSignature(raw: string, header: string | null, secret: string | undefined, toleranceSeconds = 300): boolean {
  if (!secret || !header) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't');
  const timestamp = timestamps[0]?.[1];
  if (timestamps.length !== 1 || !timestamp || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
  return parts.some(([key, sig]) => key === 'v1' && /^[a-f\d]{64}$/i.test(sig ?? '') && timingSafeEqual(expected, Buffer.from(sig, 'hex')));
}

/** Hubtel does not sign bodies: authenticate the callback, then verify its outcome via the status API. */
export function verifyHubtelWebhook(provided: string | null | undefined, secret: string | undefined): boolean {
  if (!provided || !secret) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
