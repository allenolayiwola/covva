import 'server-only';
import { paymentConfig } from '@/server/env';
import { paystackProvider } from './paystack';
import { hubtelProvider } from './hubtel';
import { stripeProvider } from './stripe';
import { simulatorProvider } from './simulator';
import type { PaymentProvider } from './payment-provider';

/** All callers resolve through the same fail-closed deployment gate. */
export function paymentProvider(): PaymentProvider {
  const providers: Record<PaymentProvider['name'], PaymentProvider> = {
    paystack: paystackProvider, hubtel: hubtelProvider, stripe: stripeProvider, simulator: simulatorProvider,
  };
  return providers[paymentConfig().provider];
}
