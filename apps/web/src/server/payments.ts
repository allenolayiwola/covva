import "server-only";
import type { Enum } from "@im/db";

/**
 * Payment service (owner: Backend stream). Premiums are paid through Paystack and
 * settle to the INSURER's subaccount — never to the platform.
 * Foundation stub: signatures are fixed; Backend implements the bodies.
 */
export interface InitiatePaymentResult {
  paymentId: string;
  reference: string;
  /** Hosted checkout URL (card / mobile money). Null when a mobile-money prompt was pushed directly. */
  authorizationUrl: string | null;
  status: Enum<"payment_status">;
}

export async function initiatePayment(_args: {
  applicationId: string;
  channel: "mobile_money" | "card" | "bank_transfer";
  /** For direct MoMo charge: E.164 phone and network. */
  momo?: { phone: string; provider: "mtn" | "vod" | "atl" };
  callbackUrl?: string;
}): Promise<InitiatePaymentResult> {
  throw new Error("initiatePayment not implemented yet");
}

/** Verify a payment with the provider and apply the result (idempotent). */
export async function verifyPayment(_reference: string): Promise<{ status: Enum<"payment_status"> }> {
  throw new Error("verifyPayment not implemented yet");
}
