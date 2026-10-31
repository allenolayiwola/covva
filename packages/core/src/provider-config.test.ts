import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentConfiguration, identityConfiguration } from './provider-config';

test('no provider or missing credentials selects simulator even in production', () => {
  for (const env of [{}, { NODE_ENV: 'production' }, { PAYMENT_PROVIDER: 'paystack' }, { PAYMENT_PROVIDER: 'stripe' }, { PAYMENT_PROVIDER: 'hubtel' }, { PAYSTACK_SECRET_KEY: 'sk_test_fixture' }]) {
    assert.deepEqual(paymentConfiguration(env), { provider: 'simulator', mode: 'Simulator' });
  }
});
test('Payment provider mode matrix fails closed without leaking keys', () => {
  for (const provider of ['paystack', 'stripe', 'hubtel']) {
    const name = provider === "hubtel" ? "HUBTEL_CLIENT_SECRET" : `${provider.toUpperCase()}_SECRET_KEY`;
    for (const mode of [undefined, 'test', 'live']) {
      for (const key of [undefined, 'sk_test_fixture', 'sk_live_fixture', 'invalid_fixture']) {
        const env = { PAYMENT_PROVIDER: provider, PAYMENTS_MODE: mode, [name]: key, STRIPE_WEBHOOK_SECRET: 'fixture', HUBTEL_CLIENT_ID: 'fixture', HUBTEL_WEBHOOK_SECRET: 'fixture' };
        const invalid = key && (key.startsWith('invalid') || (mode === 'live') !== key.startsWith('sk_live_'));
        if (invalid) assert.throws(() => paymentConfiguration(env), e => e instanceof Error && !e.message.includes(key));
        else assert.deepEqual(paymentConfiguration(env), { provider: key ? provider : 'simulator', mode: key ? mode === 'live' ? 'Live' : 'Test' : 'Simulator' });
      }
    }
  }
});
test('unused live keys, unknown selectors and unsupported Hubtel credentials cannot bypass gate', () => {
  assert.throws(() => paymentConfiguration({ PAYSTACK_SECRET_KEY: 'sk_live_fixture' }));
  assert.throws(() => paymentConfiguration({ PAYMENT_PROVIDER: 'typo' }));
  assert.throws(() => paymentConfiguration({ PAYMENTS_MODE: 'production' }));
  assert.throws(() => paymentConfiguration({ PAYMENT_PROVIDER: 'hubtel', HUBTEL_CLIENT_ID: 'fixture', HUBTEL_CLIENT_SECRET: 'fixture' }));
  assert.throws(() => paymentConfiguration({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_fixture' }));
});
test('identity stub stays manual without explicit test provider credentials; live stub refused', () => {
  assert.equal(identityConfiguration({}), 'manual');
  assert.equal(identityConfiguration({ IDENTITY_PROVIDER: 'nia' }), 'manual');
  assert.equal(identityConfiguration({ IDENTITY_PROVIDER: 'nia', NIA_API_URL: 'https://example.test', NIA_API_KEY: 'sk_test_fixture' }), 'nia');
  assert.throws(() => identityConfiguration({ NIA_API_KEY: 'sk_live_fixture' }));
});
