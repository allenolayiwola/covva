import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Server-side environment helpers. Read at call time (not module load) so runtime env is used. */
export { siteUrl } from "@/lib/site-url";

/** Sandbox payment simulator: never in production unless explicitly enabled for a staging deploy. */
export const simulatorEnabled = () =>
  process.env.PAYMENTS_SIMULATOR === "true" || (process.env.NODE_ENV !== "production" && process.env.PAYMENTS_SIMULATOR !== "false");

export const paystackKey = () => process.env.PAYSTACK_SECRET_KEY || null;

function simulatorSecret() {
  return process.env.PAYMENTS_SIMULATOR_SECRET ?? process.env.SUPABASE_SECRET_KEY ?? "dev-simulator-secret";
}

/** HMAC tag for simulator links so references can't be completed by a guessed URL. */
export function simulatorSignature(reference: string) {
  return createHmac("sha256", simulatorSecret()).update(`sim:${reference}`).digest("hex").slice(0, 32);
}

export function verifySimulatorSignature(reference: string, sig: string | null) {
  if (!sig) return false;
  const a = Buffer.from(simulatorSignature(reference));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time comparison for shared secrets in headers. */
export function secretMatches(provided: string | null | undefined, expected: string | undefined) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Diaspora card PSP: Paystack international cards settle GHS to the insurer (default); Stripe is OFF pending a legal view. */
export const diasporaPsp = (): "paystack_intl" | "stripe" => (process.env.DIASPORA_PSP?.toLowerCase() === "stripe" ? "stripe" : "paystack_intl");

/** Apple Pay / Google Pay through Paystack's hosted checkout channels (enable on the Paystack business first). */
export const applePayEnabled = () => process.env.PAYSTACK_APPLE_PAY === "true";
