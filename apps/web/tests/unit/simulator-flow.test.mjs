import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// Transport/persistence boundaries only are mocked; checkout, simulator HTTP handlers and result application are real.
const tables = {
  applications: [{ id: 'app', status: 'submitted', quote_id: 'quote', request_id: 'request', customer_id: 'customer', selected_benefits: [] }],
  quotes: [{ id: 'quote', status: 'ready_to_accept', insurer_org_id: 'insurer', currency: 'GHS', premium: 120, taxes: 5, fees: 2, billing_period: 'year' }],
  requests: [{ id: 'request', reference: 'REQ-fixture', status: 'quotes_ready', customer_id: 'customer' }],
  organizations: [{ id: 'insurer', name: 'Test insurer', type: 'insurer', status: 'active', settings: {} }],
  profiles: [{ id: 'customer', email: 'customer@example.test' }], payments: [], policies: [], request_events: [],
};
let sequence = 0;
const svc = { from(table) {
  const filters = []; let operation = 'select'; let values; let single = false;
  const query = {
    select() { return query; },
    eq(k, v) { filters.push(row => row[k] === v); return query; },
    neq(k, v) { filters.push(row => row[k] !== v); return query; },
    in(k, v) { filters.push(row => v.includes(row[k])); return query; },
    update(v) { operation = 'update'; values = v; return query; },
    insert(v) { operation = 'insert'; values = v; return query; },
    maybeSingle() { single = true; return query; }, single() { single = true; return query; },
    then(resolve, reject) {
      try {
        const rows = tables[table] ??= [];
        let result = rows.filter(row => filters.every(f => f(row)));
        if (operation === 'insert') { const row = { id: `fixture-${++sequence}`, ...values }; rows.push(row); result = [row]; }
        if (operation === 'update') result.forEach(row => Object.assign(row, values));
        return Promise.resolve({ data: structuredClone(single ? result[0] ?? null : result), error: null }).then(resolve, reject);
      } catch (e) { return Promise.reject(e).then(resolve, reject); }
    },
  };
  return query;
} };
const noop = async () => {};
class BusinessRuleError extends Error {}
mock.module('../../src/lib/supabase/server.ts', { namedExports: { createServiceClient: () => svc, createClient: () => svc } });
mock.module('../../src/server/requests.ts', { namedExports: { BusinessRuleError, ruleMessage: () => 'Test error' } });
mock.module('../../src/server/notify.ts', { namedExports: { notify: noop, notifyOrg: noop } });
mock.module('../../src/server/webhooks.ts', { namedExports: { emitEvent: noop, emitRequestStatus: noop } });
mock.module('../../src/server/commercial.ts', { namedExports: { persistPaymentSplits: noop, splitForPayment: async () => ({ summary: {}, paystackSettlement: {} }) } });
mock.module('../../src/server/ledger.ts', { namedExports: { recordPaymentLedger: noop, recordRefundLedger: noop } });
mock.module('../../src/server/fx.ts', { namedExports: { quoteFx: async amount => ({ displayAmount: amount, rate: 1, source: 'fixture' }) } });
mock.module('../../src/server/payment-methods.ts', { namedExports: { savePaymentMethodFromOutcome: noop } });
mock.module('../../src/server/loyalty.ts', { namedExports: { discountTotalForQuote: async () => 0 } });
let issuanceStarts = 0;
mock.module('../../src/server/issuance.ts', { namedExports: { startIssuance: async () => { issuanceStarts++; } } });
const { initiatePayment, applyPaymentResult } = await import('../../src/server/payments.ts');
const simulator = await import('../../src/app/api/payments/simulate/route.ts');

test('production explicitly enabled simulator checkout → signed simulator callback → one pending policy and issuance handoff', async t => {
  process.env.NODE_ENV = 'production';
  process.env.PAYMENTS_SIMULATOR = 'true';
  process.env.PAYMENTS_SIMULATOR_SECRET = 'isolated-test-signing-secret-32-chars';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  for (const key of ['PAYMENT_PROVIDER', 'PAYSTACK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'HUBTEL_CLIENT_SECRET', 'PAYMENTS_MODE']) delete process.env[key];
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No network allowed'); });
  const payment = await initiatePayment({ applicationId: 'app', userId: 'customer', channel: 'card' });
  assert.equal(payment.provider, 'simulator');
  assert.equal(payment.status, 'pending');
  assert.equal(tables.payments[0].amount, 127);
  const url = new URL(payment.authorizationUrl);
  const get = await simulator.GET({ nextUrl: url });
  assert.equal(get.status, 200);
  assert.match(await get.text(), /Test payment/);
  const form = new FormData();
  form.set('reference', payment.reference); form.set('sig', url.searchParams.get('sig')); form.set('outcome', 'success');
  const complete = () => simulator.POST(new Request(url, { method: 'POST', body: form }));
  // A provider may succeed after an earlier local failure; the pending policy must still be created.
  tables.payments[0].status = 'failed';
  assert.equal((await complete()).status, 303);
  assert.equal(tables.payments[0].status, 'succeeded');
  assert.equal(tables.policies.length, 1);
  assert.equal(tables.policies[0].status, 'pending_issuance');
  assert.equal(issuanceStarts, 1);
  assert.equal((await complete()).status, 303);
  assert.equal(tables.policies.length, 1);
  assert.equal(issuanceStarts, 1);
  assert.deepEqual(await applyPaymentResult(payment.reference, { source: 'webhook', provider: 'paystack', status: 'succeeded' }), { status: null });
  tables.payments[0].status = 'refunded';
  await complete();
  assert.equal(tables.payments[0].status, 'refunded');
  assert.equal(issuanceStarts, 1);
  process.env.PAYMENTS_MODE = 'live';
  process.env.PAYMENTS_SIMULATOR = 'true';
  await assert.rejects(complete(), /PAYMENT_PROVIDER is incompatible with PAYMENTS_MODE/);
  await assert.rejects(applyPaymentResult(payment.reference, { source: 'simulator', status: 'succeeded' }), /PAYMENT_PROVIDER is incompatible with PAYMENTS_MODE/);
  process.env.PAYMENTS_MODE = 'test';
  process.env.PAYMENTS_SIMULATOR = 'false';
  assert.equal((await complete()).status, 404);
  await assert.rejects(applyPaymentResult(payment.reference, { source: 'simulator', status: 'succeeded' }), /disabled/);
});

test('NIA stub is pending by default and test verification/DVLA never require a live key', async t => {
  const { identityProvider, dvlaVehicleProvider } = await import('../../src/server/lookups.ts');
  for (const key of ['IDENTITY_PROVIDER', 'NIA_API_URL', 'NIA_API_KEY', 'DVLA_API_URL', 'DVLA_API_KEY', 'VEHICLE_LOOKUP_PROVIDER']) delete process.env[key];
  assert.equal(identityProvider().name, 'manual');
  assert.equal((await identityProvider().verify({ ghanaCardNumber: 'GHA-TEST' })).status, 'pending');
  assert.equal(await identityProvider().lookup('GT-1234-24'), null);
  process.env.IDENTITY_PROVIDER = 'nia'; process.env.NIA_API_URL = 'https://nia.example.test'; process.env.NIA_API_KEY = 'sk_test_fixture';
  process.env.VEHICLE_LOOKUP_PROVIDER = 'dvla'; process.env.DVLA_API_URL = 'https://dvla.example.test'; process.env.DVLA_API_KEY = 'sk_test_fixture';
  t.after(() => { for (const key of ['IDENTITY_PROVIDER', 'NIA_API_URL', 'NIA_API_KEY', 'DVLA_API_URL', 'DVLA_API_KEY', 'VEHICLE_LOOKUP_PROVIDER']) delete process.env[key]; });
  t.mock.method(globalThis, 'fetch', async url => Response.json(String(url).includes('/vehicles/') ? { make: 'Test', model: 'Fixture', owner_name: 'must not be stored' } : { verified: true, reference: 'fixture', full_name: 'must not be stored' }));
  const result = await identityProvider().verify({ ghanaCardNumber: 'GHA-TEST' });
  assert.equal(result.status, 'verified');
  assert.equal(result.result.full_name, undefined);
  const vehicle = await dvlaVehicleProvider.lookup('GT-1234-24');
  assert.equal(vehicle.data.make, 'Test');
  assert.equal(vehicle.data.owner_name, undefined);
  delete process.env.VEHICLE_LOOKUP_PROVIDER;
  assert.equal(await dvlaVehicleProvider.lookup('GT-1234-24'), null);
});

test('mode endpoint requires the internal secret and returns only provider and mode', async t => {
  const { GET } = await import('../../src/app/api/payments/mode/route.ts');
  delete process.env.PAYMENTS_MODE; delete process.env.PAYMENTS_MODE_SECRET;
  assert.equal((await GET(new Request('https://example.test/api/payments/mode'))).status, 401);
  process.env.REVALIDATE_SECRET = 'unrelated-secret';
  assert.equal((await GET(new Request('https://example.test/api/payments/mode', { headers: { 'x-payments-mode-secret': 'unrelated-secret', 'x-revalidate-secret': 'unrelated-secret' } }))).status, 401);
  process.env.PAYMENTS_MODE_SECRET = 'fixture-status-secret';
  t.after(() => { delete process.env.REVALIDATE_SECRET; delete process.env.PAYMENTS_MODE_SECRET; });
  assert.equal((await GET(new Request('https://example.test/api/payments/mode', { headers: { 'x-payments-mode-secret': 'unrelated-secret' } }))).status, 401);
  const response = await GET(new Request('https://example.test/api/payments/mode', { headers: { 'x-payments-mode-secret': 'fixture-status-secret' } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true, data: { provider: 'simulator', mode: 'Simulator' } });
});

test('real webhook routes reject missing signatures and inactive providers; valid signed events are accepted', async t => {
  const { createHmac } = await import('node:crypto');
  mock.module('../../src/server/subscriptions.ts', { namedExports: { handlePaystackSubscriptionEvent: noop } });
  const paystack = await import('../../src/app/api/webhooks/paystack/route.ts');
  const stripe = await import('../../src/app/api/webhooks/stripe/route.ts');
  const hubtel = await import('../../src/app/api/webhooks/hubtel/route.ts');
  const secret = 'sk_test_fixture';
  t.after(() => { for (const key of ['PAYMENT_PROVIDER', 'PAYSTACK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'HUBTEL_CLIENT_ID', 'HUBTEL_CLIENT_SECRET', 'HUBTEL_WEBHOOK_SECRET']) delete process.env[key]; });
  process.env.PAYMENTS_MODE = 'test';
  const raw = JSON.stringify({ event: 'test.ping', type: 'test.ping', data: {} });
  const request = (headers = {}) => new Request('https://example.test/webhook', { method: 'POST', body: raw, headers });
  process.env.PAYMENT_PROVIDER = 'paystack'; process.env.PAYSTACK_SECRET_KEY = secret;
  assert.equal((await paystack.POST(request())).status, 401);
  assert.equal((await paystack.POST(request({ 'x-paystack-signature': createHmac('sha512', secret).update(raw).digest('hex') }))).status, 200);
  process.env.PAYMENT_PROVIDER = 'stripe'; process.env.STRIPE_SECRET_KEY = secret; process.env.STRIPE_WEBHOOK_SECRET = 'fixture';
  assert.equal((await paystack.POST(request({ 'x-paystack-signature': createHmac('sha512', secret).update(raw).digest('hex') }))).status, 401);
  assert.equal((await stripe.POST(request())).status, 401);
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal((await stripe.POST(request({ 'stripe-signature': `t=${timestamp},v1=${createHmac('sha256', 'fixture').update(`${timestamp}.${raw}`).digest('hex')}` }))).status, 200);
  process.env.PAYMENT_PROVIDER = 'hubtel'; process.env.HUBTEL_CLIENT_ID = 'fixture'; process.env.HUBTEL_CLIENT_SECRET = secret; process.env.HUBTEL_WEBHOOK_SECRET = 'fixture';
  const hreq = request(); hreq.nextUrl = new URL(hreq.url);
  assert.equal((await hubtel.POST(hreq)).status, 401);
  const signed = request({ 'x-hubtel-secret': 'fixture' }); signed.nextUrl = new URL(signed.url);
  assert.equal((await hubtel.POST(signed)).status, 200);
});

test('Hubtel callbacks trust status API for failures, refunds and success; missing amount cannot confirm', async t => {
  const { POST } = await import('../../src/app/api/webhooks/hubtel/route.ts');
  const { verifyPayment } = await import('../../src/server/payments.ts');
  process.env.PAYMENTS_MODE = 'test'; process.env.PAYMENT_PROVIDER = 'hubtel';
  process.env.HUBTEL_CLIENT_ID = 'fixture'; process.env.HUBTEL_CLIENT_SECRET = 'sk_test_fixture'; process.env.HUBTEL_WEBHOOK_SECRET = 'fixture';
  t.after(() => { for (const key of ['PAYMENT_PROVIDER', 'HUBTEL_CLIENT_ID', 'HUBTEL_CLIENT_SECRET', 'HUBTEL_WEBHOOK_SECRET']) delete process.env[key]; });
  const payment = { ...structuredClone(tables.payments[0]), id: 'hubtel-payment', provider: 'hubtel', provider_reference: 'hubtel-fixture', settlement_subaccount: 'merchant-fixture', status: 'pending' };
  tables.payments.push(payment);
  let verified = { status: 'Pending' };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(String(url), /api-txnstatus\.hubtel\.com\/transactions\/merchant-fixture\/status/);
    calls++;
    return Response.json({ data: verified });
  });
  const callback = () => {
    const req = new Request('https://example.test/api/webhooks/hubtel', { method: 'POST', headers: { 'x-hubtel-secret': 'fixture' }, body: JSON.stringify({ Status: 'Failed', Data: { ClientReference: 'hubtel-fixture' } }) });
    req.nextUrl = new URL(req.url);
    return POST(req);
  };
  assert.equal((await callback()).status, 503);
  assert.equal(payment.status, 'pending');
  verified = { status: 'Paid' };
  assert.equal((await callback()).status, 503);
  assert.equal((await verifyPayment('hubtel-fixture')).status, 'pending');
  assert.equal(payment.status, 'pending');
  verified = { status: 'Failed' };
  assert.equal((await callback()).status, 200);
  assert.equal(payment.status, 'failed');
  verified = { status: 'Paid', amount: 127 };
  const before = issuanceStarts;
  assert.equal((await callback()).status, 200);
  assert.equal(payment.status, 'succeeded');
  assert.equal(issuanceStarts, before + 1);
  assert.equal((await callback()).status, 200);
  assert.equal(issuanceStarts, before + 1);
  verified = { status: 'Refunded' };
  assert.equal((await callback()).status, 200);
  assert.equal(payment.status, 'refunded');
  assert.equal(calls, 7);
});

test('removing provider configuration cannot turn a real payment refund into a simulated refund', async t => {
  const { refundPayment } = await import('../../src/server/payments.ts');
  delete process.env.PAYMENT_PROVIDER; delete process.env.PAYSTACK_SECRET_KEY;
  const payment = { ...structuredClone(tables.payments[0]), id: 'real-refund-fixture', provider: 'paystack', status: 'succeeded' };
  tables.payments.push(payment);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No network allowed'); });
  await assert.rejects(refundPayment(payment.id, 'Test refund'), /not configured|not selected/);
  assert.equal(payment.status, 'succeeded');
});
