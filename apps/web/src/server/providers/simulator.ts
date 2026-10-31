import 'server-only';
import { simulatorEnabled, simulatorSignature, verifySimulatorSignature, siteUrl } from '@/server/env';
import type { PaymentProvider } from './payment-provider';
function requireSimulator() {
  if (!simulatorEnabled()) throw new Error('The payment simulator is disabled.');
}
/** Persisted outcomes belong to payments.ts; the simulator never claims an uncompleted link is paid. */
export const simulatorProvider: PaymentProvider = {
  name: 'simulator',
  async initialise(input) {
    requireSimulator();
    return { reference: input.reference, authorizationUrl: `${siteUrl()}/api/payments/simulate?reference=${encodeURIComponent(input.reference)}&sig=${simulatorSignature(input.reference)}` };
  },
  async verify() { requireSimulator(); return { status: 'pending' }; },
  async refund() { requireSimulator(); return { status: 'processed' }; },
  settlement() { requireSimulator(); return { subaccount: 'SIMULATED' }; },
  verifyWebhook(reference, signature) { return simulatorEnabled() && verifySimulatorSignature(reference, signature); },
};
