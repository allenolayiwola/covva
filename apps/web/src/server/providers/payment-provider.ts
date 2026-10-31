/** Provider transport contract. Business authorisation, persistence and issuance stay in payments.ts. */
export interface PaymentProvider {
  readonly name: 'paystack' | 'hubtel' | 'stripe' | 'simulator';
  initialise(input: PaymentInitialise): Promise<PaymentInitialised>;
  verify(reference: string, settlementAccount?: string | null): Promise<PaymentVerified>;
  refund(reference: string, amountMinor: number): Promise<{ status: 'requested' | 'processed' }>;
  settlement(input: { subaccount: string; splitCode?: string | null }): Record<string, string>;
  verifyWebhook(raw: string, signature: string | null): boolean;
}
export interface PaymentInitialise {
  reference: string;
  amountMinor: number;
  currency: 'GHS' | 'GBP' | 'USD' | 'EUR' | 'CAD';
  email: string;
  callbackUrl: string;
  description: string;
  settlementAccount: string;
  splitCode?: string | null;
  metadata?: Record<string, string>;
}
export interface PaymentInitialised { authorizationUrl: string | null; reference: string }
export interface PaymentVerified {
  status: 'succeeded' | 'failed' | 'pending' | 'refunded' | 'unknown';
  amountMinor?: number;
  currency?: string;
  raw?: unknown;
}
export function unsupported(operation: string): never {
  throw new Error(`This provider does not support ${operation}; use the documented operations process.`);
}
