import { test, beforeEach } from 'node:test';
// These values exist only in this isolated test worker.
beforeEach(t => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; });
});
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyPaystackSignature, verifyStripeSignature, verifyHubtelWebhook } from '../../src/server/providers/signatures.ts';
const body = '{"reference":"fixture"}';
const secret = 'fixture-secret';
test('Paystack signatures require exact SHA512 hex over the raw bytes', () => {
  const signature = createHmac('sha512', secret).update(body).digest('hex');
  assert.equal(verifyPaystackSignature(body, signature, secret), true);
  for (const sig of [null, '', signature + 'zz', signature.slice(2), 'bad']) assert.equal(verifyPaystackSignature(body, sig, secret), false);
  assert.equal(verifyPaystackSignature(body + ' ', signature, secret), false);
  assert.equal(verifyPaystackSignature(body, signature, ''), false);
});
test('Stripe requires a finite timestamp, fresh signature, and supports rotating signatures', () => {
  const t = Math.floor(Date.now() / 1000);
  const sign = ts => createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sign(t)}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=bad,v1=${sign(t)},v1=bad`, secret), true);
  for (const ts of ['NaN', 'Infinity', '', t - 301, t + 301]) assert.equal(verifyStripeSignature(body, `t=${ts},v1=${sign(ts)}`, secret), false);
  assert.equal(verifyStripeSignature(body + ' ', `t=${t},v1=${sign(t)}`, secret), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sign(t)}zz`, secret), false);
  assert.equal(verifyStripeSignature(body, null, secret), false);
});
test('Hubtel callback authentication fails closed', () => {
  assert.equal(verifyHubtelWebhook(secret, secret), true);
  for (const value of [null, '', 'bad', secret + 'x']) assert.equal(verifyHubtelWebhook(value, secret), false);
  assert.equal(verifyHubtelWebhook(secret, ''), false);
});

test('Paystack test transport uses mocked fetch for initialise, verify, refund and split', async t => {
  process.env.PAYMENT_PROVIDER = 'paystack';
  process.env.PAYMENTS_MODE = 'test';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_fixture';
  t.after(() => { delete process.env.PAYMENT_PROVIDER; delete process.env.PAYMENTS_MODE; delete process.env.PAYSTACK_SECRET_KEY; });
  const { paystackProvider } = await import('../../src/server/providers/paystack.ts');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ status: true, data: String(url).includes('/initialize') ? { authorization_url: 'https://checkout.example.test' } : { status: 'success', amount: 12300, currency: 'GHS' } });
  });
  assert.deepEqual(await paystackProvider.initialise({ reference: 'fixture', amountMinor: 12300, currency: 'GHS', email: 'test@example.test', callbackUrl: 'https://example.test/return', description: 'Test premium', settlementAccount: 'ACCT_fixture', splitCode: 'SPL_fixture' }), { reference: 'fixture', authorizationUrl: 'https://checkout.example.test' });
  assert.equal(JSON.parse(calls[0].options.body).split_code, 'SPL_fixture');
  assert.equal(JSON.parse(calls[0].options.body).amount, 12300);
  assert.equal((await paystackProvider.verify('fixture')).status, 'succeeded');
  assert.deepEqual(await paystackProvider.refund('fixture', 12300), { status: 'requested' });
  assert.deepEqual(paystackProvider.settlement({ subaccount: 'ACCT_fixture' }), { subaccount: 'ACCT_fixture', bearer: 'subaccount' });
  assert.equal(calls.length, 3);
  delete process.env.PAYMENT_PROVIDER;
  await assert.rejects(paystackProvider.verify('fixture'), /not selected/);
  assert.equal(calls.length, 3);
});

test('simulator link completion authenticates reference and is always disabled in live mode', async t => {
  const { simulatorProvider } = await import('../../src/server/providers/simulator.ts');
  process.env.NODE_ENV = 'production';
  process.env.PAYMENTS_SIMULATOR = 'true';
  process.env.PAYMENTS_SIMULATOR_SECRET = 'isolated-test-signing-secret-32-chars';
  t.after(() => { delete process.env.PAYMENTS_MODE; delete process.env.PAYMENTS_SIMULATOR; delete process.env.NODE_ENV; delete process.env.PAYMENTS_SIMULATOR_SECRET; });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  const result = await simulatorProvider.initialise({ reference: 'fixture', amountMinor: 100, currency: 'GHS', email: 'test@example.test', callbackUrl: 'https://example.test', description: 'Test', settlementAccount: 'SIMULATED' });
  const url = new URL(result.authorizationUrl);
  assert.equal(simulatorProvider.verifyWebhook('fixture', url.searchParams.get('sig')), true);
  assert.equal(simulatorProvider.verifyWebhook('another', url.searchParams.get('sig')), false);
  assert.equal((await simulatorProvider.verify('fixture')).status, 'pending');
  assert.equal((await simulatorProvider.refund('fixture', 100)).status, 'processed');
  process.env.PAYMENTS_MODE = 'live';
  process.env.PAYMENTS_SIMULATOR = 'true';
  assert.equal(simulatorProvider.verifyWebhook('fixture', url.searchParams.get('sig')), false);
  await assert.rejects(simulatorProvider.initialise({ reference: 'fixture' }), /disabled/);
});

test('startup validates credentials before accepting requests without exposing key values', async t => {
  const { register } = await import('../../src/instrumentation.ts');
  process.env.PAYMENT_PROVIDER = 'paystack'; process.env.PAYMENTS_MODE = 'live';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_startup_fixture';
  t.after(() => { delete process.env.PAYMENT_PROVIDER; delete process.env.PAYMENTS_MODE; delete process.env.PAYSTACK_SECRET_KEY; });
  assert.throws(register, error => /PAYSTACK_SECRET_KEY/.test(error.message) && !error.message.includes('sk_test_startup_fixture'));
  delete process.env.PAYSTACK_SECRET_KEY;
  for (const provider of ['paystack', 'stripe', 'hubtel']) {
    process.env.PAYMENT_PROVIDER = provider;
    assert.throws(register, /credentials.*live/);
  }
});

test('Paystack refuses empty settlementAccount before transport, including with a split', async t => {
  const { paystackProvider } = await import('../../src/server/providers/paystack.ts');
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Settlement validation must precede transport'); });
  for (const settlementAccount of ['', '   ']) {
    for (const splitCode of [undefined, 'SPL_fixture']) {
      assert.throws(() => paystackProvider.settlement({ subaccount: settlementAccount, splitCode }), /settlementAccount/);
      await assert.rejects(paystackProvider.initialise({ settlementAccount, splitCode }), /settlementAccount/);
    }
  }
});

test('startup rejects enabled production simulator without a dedicated strong secret', async t => {
  const { register } = await import('../../src/instrumentation.ts');
  process.env.NODE_ENV = 'production';
  process.env.PAYMENTS_SIMULATOR = 'true';
  t.after(() => { delete process.env.PAYMENTS_SIMULATOR; delete process.env.PAYMENTS_SIMULATOR_SECRET; });
  for (const secret of ['', 'short-fixture']) {
    process.env.PAYMENTS_SIMULATOR_SECRET = secret;
    assert.throws(register, error => /PAYMENTS_SIMULATOR_SECRET.*32/.test(error.message) && !error.message.includes('short-fixture'));
  }
});
