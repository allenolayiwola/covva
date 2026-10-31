import { paymentConfig, secretMatches } from '@/server/env';
/** Read-only status for the separately deployed staff console. Never return credentials. */
export async function GET(req: Request) {
  if (!secretMatches(req.headers.get('x-payments-mode-secret'), process.env.PAYMENTS_MODE_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  return Response.json({ ok: true, data: paymentConfig() }, { headers: { 'cache-control': 'no-store' } });
}
