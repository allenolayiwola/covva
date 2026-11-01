import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Server-side environment helpers for the marketing site. Payment settings live in the app (covva-app). */
export { appUrl, siteUrl } from "@/lib/site-url";

/** Constant-time comparison for shared secrets in headers. */
export function secretMatches(provided: string | null | undefined, expected: string | undefined) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
