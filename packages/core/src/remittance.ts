/**
 * Remittance / diaspora-bank partner adapter (Roadmap Phase 4, deferred: no partner yet).
 *
 * The shape a partner integration implements so a sponsor abroad can pay a premium or a welfare contribution from
 * inside the partner's app. The partner collects in the sponsor's currency; the settlement to the insurer is still a
 * GHS `payments` row on Covva's side (payee = insurer, broker commission by split), never a Covva balance. Nothing
 * here is wired up — `remittance_partners` rows exist for the admin list only. See docs/WELFARE_GROUPS.md.
 */
export interface RemittanceQuoteRequest {
  /** What the insurer must receive. */
  ghsAmount: number;
  /** The sponsor's currency (GBP, USD, EUR, CAD …). */
  payerCurrency: string;
  /** Covva's own reference for the premium / contribution (the `payments.provider_reference`). */
  reference: string;
}

export interface RemittanceQuote {
  partnerQuoteId: string;
  payerAmount: number;
  payerCurrency: string;
  ghsAmount: number;
  rate: number;
  fees: { amount: number; currency: string; description: string }[];
  expiresAt: string;
}

export interface RemittancePayment {
  partnerPaymentId: string;
  status: "pending" | "succeeded" | "failed";
  /** Settlement to the insurer's account in GHS, when the partner reports it. */
  settledGhsAmount?: number | null;
  settledAt?: string | null;
  failureReason?: string | null;
}

export interface RemittancePartnerAdapter {
  /** Stable partner slug (matches `remittance_partners.slug`). */
  readonly slug: string;
  /** Indicative amount in the payer's currency for a GHS premium; shown with Covva's FX disclosure. */
  quote(input: RemittanceQuoteRequest): Promise<RemittanceQuote>;
  /** Start a payment against a quote; the partner redirects or prompts the payer in its own app. */
  initiate(input: { quote: RemittanceQuote; payerId: string; returnUrl: string }): Promise<{ partnerPaymentId: string; redirectUrl: string | null }>;
  /** Verify a partner webhook and translate it into a payment outcome for `applyPaymentResult`. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<RemittancePayment | null>;
}
