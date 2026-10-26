/** Small, framework-free helpers shared by the auth and customer areas (safe on server and client). */

/**
 * Normalise a Ghana phone number to E.164.
 * "024 123 4567" → "+233241234567", "233241234567" → "+233241234567".
 * Returns null when the input cannot be a Ghana mobile/landline number.
 */
export function normaliseGhanaPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("233")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^\d{9}$/.test(digits)) return null;
  return `+233${digits}`;
}

/** Display format for an E.164 Ghana number: +233 24 123 4567 */
export function formatGhanaPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const m = e164.replace(/\s+/g, "").match(/^\+233(\d{2})(\d{3})(\d{4})$/);
  return m ? `+233 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: unknown, fallback = "/account"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] || "there";
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_UPLOADS = "application/pdf,image/jpeg,image/png,image/webp,image/heic";

/** Ghana Card format: GHA-123456789-0 */
export function normaliseGhanaCard(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toUpperCase().replace(/\s+/g, "");
  const m = s.match(/^GHA-?(\d{9})-?(\d)$/);
  return m ? `GHA-${m[1]}-${m[2]}` : null;
}

export type ActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Free-form payload for client follow-ups (e.g. created ids). */
  data?: Record<string, unknown>;
};

export const initialActionState: ActionState = { ok: false };
