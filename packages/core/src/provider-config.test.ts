import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentConfiguration, identityConfiguration, paymentSimulatorEnabled } from './provider-config';

test('non-live provider selection uses simulator when credentials are missing', () => {
  for (const env of [{}, { NODE_ENV: 'production' }, { PAYMENT_PROVIDER: 'paystack' }, { PAYMENT_PROVIDER: 'stripe' }, { PAYMENT_PROVIDER: 'hubtel' }, { PAYSTACK_SECRET_KEY: 'sk_test_fixture' }]) {
    assert.deepEqual(paymentConfiguration({ NODE_ENV: 'development', ...env }), { provider: 'simulator', mode: 'Simulator' });
  }
});
test('Payment provider mode matrix fails closed without leaking keys', () => {
  for (const provider of ['paystack', 'stripe', 'hubtel']) {
    const name = provider === "hubtel" ? "HUBTEL_CLIENT_SECRET" : `${provider.toUpperCase()}_SECRET_KEY`;
    for (const mode of [undefined, 'test', 'live']) {
      for (const key of [undefined, 'sk_test_fixture', 'sk_live_fixture', 'invalid_fixture']) {
        const env = { PAYMENT_PROVIDER: provider, PAYMENTS_MODE: mode, [name]: key, STRIPE_WEBHOOK_SECRET: 'fixture', HUBTEL_CLIENT_ID: 'fixture', HUBTEL_WEBHOOK_SECRET: 'fixture' };
        const invalid = (mode === 'live' && !key) || key && (key.startsWith('invalid') || (mode === 'live') !== key.startsWith('sk_live_'));
        if (invalid) assert.throws(() => paymentConfiguration({ NODE_ENV: 'development', ...env }), e => e instanceof Error && (!key || !e.message.includes(key)));
        else assert.deepEqual(paymentConfiguration({ NODE_ENV: 'development', ...env }), { provider: key ? provider : 'simulator', mode: key ? mode === 'live' ? 'Live' : 'Test' : 'Simulator' });
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

for (const productionMarker of ['NODE_ENV', 'VERCEL_ENV']) {
  test(`${productionMarker} production refuses simulator without explicit opt-in`, () => {
    const env = { NODE_ENV: 'development', [productionMarker]: 'production' };
    assert.equal(paymentSimulatorEnabled(env, paymentConfiguration(env).provider), false);
    assert.equal(paymentSimulatorEnabled({ ...env, PAYMENTS_SIMULATOR: 'false' }, 'simulator'), false);
    assert.equal(paymentSimulatorEnabled({ ...env, PAYMENTS_SIMULATOR: 'true' }, 'simulator'), true);
    assert.equal(paymentSimulatorEnabled({ ...env, PAYMENTS_SIMULATOR: 'true', PAYMENTS_MODE: 'live' }, 'simulator'), false);
  });
}
test('enabled simulator outside development requires a dedicated 32-character secret', () => {
  for (const environment of [{}, { NODE_ENV: 'test' }, { NODE_ENV: 'production' }, { VERCEL_ENV: 'production', NODE_ENV: 'development' }]) {
    for (const secret of [undefined, '', 'x'.repeat(31)]) {
      assert.throws(() => paymentConfiguration({ ...environment, PAYMENTS_SIMULATOR: 'true', PAYMENTS_SIMULATOR_SECRET: secret, SUPABASE_SECRET_KEY: 'unrelated-secret' }), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /PAYMENTS_SIMULATOR_SECRET.*32/);
        assert.ok(!error.message.includes('unrelated-secret'));
        if (secret) assert.ok(!error.message.includes(secret));
        return true;
      });
    }
    assert.equal(paymentConfiguration({ ...environment, PAYMENTS_SIMULATOR: 'true', PAYMENTS_SIMULATOR_SECRET: 'x'.repeat(32) }).provider, 'simulator');
  }
});
test('live provider with missing credentials fails closed', () => {
  for (const provider of ['paystack', 'stripe', 'hubtel']) {
    assert.throws(() => paymentConfiguration({ PAYMENT_PROVIDER: provider, PAYMENTS_MODE: 'live' }), /credentials.*live/);
  }
});
