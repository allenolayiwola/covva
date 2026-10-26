import type { NextRequest } from "next/server";
import { z } from "zod";
import { isVerificationCode } from "@im/core";
import { verifyPolicyLookup } from "@/app/api/public/verify-policy/route";
import { clientIp, takeToken } from "@/server/api-auth";

const Query = z.object({ code: z.string().trim().optional(), insurer: z.string().trim().max(80).optional(), policyNumber: z.string().trim().max(60).optional() });
const LIMIT = { capacity: 30, refillPerSecond: 0.25, name: "verify-v1" } as const;
const NO_STORE = { "cache-control": "private, no-store" };

/**
 * GET /api/v1/verify?code=… (or ?insurer=<slug>&policyNumber=…) — public, unauthenticated policy
 * check for the mobile app's scanner and partner tools. Same minimal output as the web verify page.
 */
export async function GET(req: NextRequest) {
  const rl = takeToken(`${LIMIT.name}|${clientIp(req)}`, LIMIT);
  if (!rl.ok) return Response.json({ ok: false, error: { code: "rate_limited", message: "Too many checks. Please wait and try again." } }, { status: 429, headers: { ...NO_STORE, "retry-after": String(rl.retryAfter) } });
  const q = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  const code = q.success && q.data.code && isVerificationCode(q.data.code) ? q.data.code.toUpperCase() : null;
  const byNumber = q.success && q.data.insurer && q.data.policyNumber && q.data.policyNumber.length >= 3 ? { insurer: q.data.insurer.toLowerCase(), policyNumber: q.data.policyNumber } : null;
  if (!code && !byNumber) return Response.json({ ok: false, error: { code: "invalid_input", message: "Provide code, or insurer and policyNumber." } }, { status: 400, headers: NO_STORE });
  try {
    const data = await verifyPolicyLookup(code ? { code } : byNumber!);
    return Response.json({ ok: true, data }, { headers: NO_STORE });
  } catch {
    return Response.json({ ok: false, error: { code: "unavailable", message: "Verification is not available right now." } }, { status: 503, headers: NO_STORE });
  }
}
