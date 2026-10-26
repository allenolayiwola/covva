import type { NextRequest } from "next/server";
import { z } from "zod";
import { isVerificationCode } from "@im/core";
import { createPublicClient } from "@/lib/supabase/server";
import { clientIp, takeToken } from "@/server/api-auth";

/**
 * POST /api/public/verify-policy — public QR / policy-number lookup (Addendum 5 §6, Roadmap
 * "Policy wallet"). Input: { code } (the QR / wallet verification code) OR { insurer: <org slug>,
 * policyNumber }. Backed by the anon-callable `verify_policy` RPC, whose output is deliberately
 * minimal: { valid, status, insurerName, coverStart, coverEnd, categoryName, policyNumberMasked }.
 * Never returns customer data. Rate-limited per IP with the shared in-memory limiter.
 */
const Body = z
  .object({
    code: z.string().trim().min(6).max(20).optional(),
    insurer: z.string().trim().max(80).optional(),
    policyNumber: z.string().trim().max(60).optional(),
  })
  .refine((b) => (b.code && isVerificationCode(b.code)) || (b.insurer && b.insurer.length > 0 && b.policyNumber && b.policyNumber.length >= 3), { message: "Provide the verification code, or the insurer and the policy number." });

const VERIFY_LIMIT = { capacity: 20, refillPerSecond: 0.2, name: "verify" } as const;
const NO_STORE = { "cache-control": "private, no-store" };

export type VerifyResponse = {
  valid: boolean;
  status?: string;
  insurerName?: string;
  coverStart?: string | null;
  coverEnd?: string | null;
  categoryName?: string;
  policyNumberMasked?: string | null;
  message?: string;
};

type RpcResult = { valid: boolean; status: string; insurer_name?: string; category_name?: string; cover_start?: string | null; cover_end?: string | null; policy_number_masked?: string | null };

/** Shared by the public web route and GET /api/v1/verify. */
export async function verifyPolicyLookup(input: { code?: string; insurer?: string; policyNumber?: string }): Promise<VerifyResponse> {
  const sb = createPublicClient();
  const { data, error } = await sb.rpc("verify_policy", { p_code: input.code ?? undefined, p_insurer: input.insurer ?? undefined, p_policy_number: input.policyNumber ?? undefined });
  if (error) throw error;
  const r = (data ?? { valid: false, status: "not_found" }) as RpcResult;
  if (!r.valid && (r.status === "not_found" || r.status === "invalid_input")) {
    return { valid: false, message: input.code ? "We could not find a policy for that code. Check it was scanned from a Covva wallet or certificate." : "No policy with that number was found for this insurer." };
  }
  const body: VerifyResponse = {
    valid: r.valid,
    status: r.status.replace(/_/g, " "),
    insurerName: r.insurer_name,
    coverStart: r.cover_start ?? null,
    coverEnd: r.cover_end ?? null,
    categoryName: r.category_name ?? "Insurance policy",
    policyNumberMasked: r.policy_number_masked ?? null,
  };
  if (!r.valid) body.message = `This policy exists but is not currently active (${body.status}).`;
  return body;
}

export async function POST(req: NextRequest) {
  const rl = takeToken(`${VERIFY_LIMIT.name}|${clientIp(req)}`, VERIFY_LIMIT);
  if (!rl.ok) {
    return Response.json({ valid: false, message: "Too many checks. Please wait and try again." } satisfies VerifyResponse, { status: 429, headers: { ...NO_STORE, "retry-after": String(rl.retryAfter) } });
  }
  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch {
    return Response.json({ valid: false, message: "Please provide the verification code, or the insurer and the policy number." } satisfies VerifyResponse, { status: 400, headers: NO_STORE });
  }
  try {
    const body = await verifyPolicyLookup(input.code && isVerificationCode(input.code) ? { code: input.code.toUpperCase() } : { insurer: input.insurer?.toLowerCase(), policyNumber: input.policyNumber });
    return Response.json(body, { headers: NO_STORE });
  } catch {
    return Response.json({ valid: false, message: "Verification is not available right now. Please try again." } satisfies VerifyResponse, { status: 503, headers: NO_STORE });
  }
}
