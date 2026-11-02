/**
 * The partner-workspace MFA rule (Addendum 4), kept free of server imports so the gate in `lib/auth.ts`,
 * the `/partner/mfa` page and the unit tests all share one definition.
 */

/**
 * Platform-wide switch: TOTP (Supabase Auth AAL2) for broker and insurer users. Defaults to on in production
 * and off elsewhere so local demos and the Playwright suite (which sets `PARTNER_MFA_REQUIRED=false`
 * explicitly) can use password-only demo accounts.
 */
export function partnerMfaRequired(): boolean {
  const raw = process.env.PARTNER_MFA_REQUIRED?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Whether these partner memberships must verify with TOTP: the platform switch is on and at least one of the
 * organisations requires it (`organizations.require_mfa`, on unless an org admin turned it off).
 */
export function mfaRequiredFor(partner: readonly { org: { require_mfa: boolean | null } }[]): boolean {
  return partnerMfaRequired() && partner.some((m) => m.org.require_mfa !== false);
}
