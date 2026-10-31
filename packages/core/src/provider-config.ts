/** Pure configuration gate shared by startup and every provider entry point. Never returns credentials. */
export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;
export type PaymentProviderName = 'simulator' | 'paystack' | 'hubtel' | 'stripe';
export type PaymentMode = 'Simulator' | 'Test' | 'Live';

/** Explicit opt-out and live mode disable simulation; production requires an explicit opt-in. */
export function paymentSimulatorEnabled(env: ProviderEnvironment, provider: PaymentProviderName): boolean {
  const isProd = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  return provider === 'simulator' && env.PAYMENTS_MODE !== 'live' && env.PAYMENTS_SIMULATOR !== 'false' && (!isProd || env.PAYMENTS_SIMULATOR === 'true');
}

export function validateSimulatorSecret(env: ProviderEnvironment): void {
  const isDev = env.NODE_ENV === 'development' && env.VERCEL_ENV !== 'production';
  if (!isDev && (!env.PAYMENTS_SIMULATOR_SECRET || env.PAYMENTS_SIMULATOR_SECRET.length < 32)) {
    throw new Error('PAYMENTS_SIMULATOR_SECRET must contain at least 32 characters when the payment simulator is enabled outside development.');
  }
}

export function paymentConfiguration(env: ProviderEnvironment): { provider: PaymentProviderName; mode: PaymentMode } {
  const mode = env.PAYMENTS_MODE || 'test';
  if (!['test', 'live'].includes(mode)) throw new Error('PAYMENTS_MODE must be test or live.');
  // Validate all supplied keys, including inactive providers, so a dormant live key cannot be activated accidentally.
  for (const name of ['PAYSTACK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'HUBTEL_CLIENT_SECRET']) {
    const key = env[name];
    if (!key) continue;
    if (!key.startsWith('sk_test_') && !key.startsWith('sk_live_')) throw new Error(`${name} has no supported test/live prefix; provider transport is disabled.`);
    if (key.startsWith('sk_live_') && mode !== 'live') throw new Error(`${name} requires explicit PAYMENTS_MODE=live.`);
    if (key.startsWith('sk_test_') && mode === 'live') throw new Error(`${name} is a test key but PAYMENTS_MODE=live.`);
  }
  const wanted = (env.PAYMENT_PROVIDER || 'simulator').toLowerCase();
  if (!['simulator', 'paystack', 'hubtel', 'stripe'].includes(wanted)) throw new Error('PAYMENT_PROVIDER must be simulator, paystack, hubtel or stripe.');
  if (wanted === 'simulator' && mode === 'live') {
    throw new Error('PAYMENT_PROVIDER is incompatible with PAYMENTS_MODE.');
  }
  const key = wanted === 'paystack' ? env.PAYSTACK_SECRET_KEY : wanted === 'stripe' ? env.STRIPE_SECRET_KEY : wanted === 'hubtel' && env.HUBTEL_CLIENT_ID ? env.HUBTEL_CLIENT_SECRET : undefined;
  if (mode === 'live' && wanted !== 'simulator' && !key) {
    throw new Error('Selected PAYMENT_PROVIDER requires its credentials in live mode.');
  }
  if (!key || wanted === 'simulator') {
    if (paymentSimulatorEnabled(env, 'simulator')) validateSimulatorSecret(env);
    return { provider: 'simulator', mode: 'Simulator' };
  }
  if (wanted === 'hubtel' && !env.HUBTEL_WEBHOOK_SECRET) throw new Error('HUBTEL_WEBHOOK_SECRET is required for Hubtel.');
  if (wanted === 'stripe' && !env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is required for Stripe.');
  return { provider: wanted as PaymentProviderName, mode: mode === 'live' ? 'Live' : 'Test' };
}

/** NIA/DVLA contracts are placeholders. Only explicitly labelled test credentials may call them. */
export function identityConfiguration(env: ProviderEnvironment): 'manual' | 'nia' {
  for (const name of ['NIA_API_KEY', 'DVLA_API_KEY']) {
    if (env[name] && !env[name]!.startsWith('sk_test_')) throw new Error(`${name}: only test credentials are supported by the identity/DVLA stub; live integration requires a validated provider contract.`);
  }
  const provider = (env.IDENTITY_PROVIDER || 'manual').toLowerCase();
  if (!['manual', 'stub', 'nia'].includes(provider)) throw new Error('IDENTITY_PROVIDER must be manual, stub or nia.');
  return provider === 'nia' && env.NIA_API_URL && env.NIA_API_KEY ? 'nia' : 'manual';
}
