import type { NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp, takeToken } from "@/server/api-auth";

/**
 * POST /api/public/verify-policy — public QR / policy-number lookup (Addendum 5 §6).
 * Input: { insurer: <organisation slug>, policyNumber }. Output is deliberately minimal:
 * { valid, status, insurerName, coverStart, coverEnd, categoryName } for an issued policy.
 * Never returns customer data. Rate-limited per IP with the shared in-memory limiter.
 */
const Body = z.object({
  insurer: z.string().trim().min(1).max(80),
  policyNumber: z.string().trim().min(3).max(60),
});

const VERIFY_LIMIT = { capacity: 20, refillPerSecond: 0.2, name: "verify" } as const;
const NO_STORE = { "cache-control": "private, no-store" };
const ACTIVE_STATUSES = new Set(["active", "renewed"]);

type VerifyResponse = {
  valid: boolean;
  status?: string;
  insurerName?: string;
  coverStart?: string | null;
  coverEnd?: string | null;
  categoryName?: string;
  message?: string;
};

export async function POST(req: NextRequest) {
  const rl = takeToken(`${VERIFY_LIMIT.name}|${clientIp(req)}`, VERIFY_LIMIT);
  if (!rl.ok) {
    return Response.json({ valid: false, message: "Too many checks. Please wait and try again." } satisfies VerifyResponse, {
      status: 429,
      headers: { ...NO_STORE, "retry-after": String(rl.retryAfter) },
    });
  }

  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch {
    return Response.json({ valid: false, message: "Please provide the insurer and the policy number." } satisfies VerifyResponse, { status: 400, headers: NO_STORE });
  }

  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    return Response.json({ valid: false, message: "Verification is not available on this environment." } satisfies VerifyResponse, { status: 503, headers: NO_STORE });
  }

  const { data: org } = await svc.from("organizations").select("id, name").eq("slug", input.insurer.toLowerCase()).eq("type", "insurer").maybeSingle();
  if (!org) {
    return Response.json({ valid: false, message: "We do not recognise that insurer. Choose one from the list." } satisfies VerifyResponse, { headers: NO_STORE });
  }

  // Exact-match on policy number (case-insensitive) and the chosen insurer only. No customer columns are selected.
  // `ilike` treats % and _ as wildcards, so they are escaped to keep the match exact.
  const pattern = input.policyNumber.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { data: policy } = await svc
    .from("policies")
    .select("status, cover_start, cover_end, category:product_categories!policies_category_id_fkey(name)")
    .eq("insurer_org_id", org.id)
    .ilike("policy_number", pattern)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!policy) {
    return Response.json({ valid: false, message: "No policy with that number was found for this insurer." } satisfies VerifyResponse, { headers: NO_STORE });
  }

  const category = policy.category as unknown as { name: string } | null;
  const today = new Date().toISOString().slice(0, 10);
  const inDates = (!policy.cover_start || policy.cover_start <= today) && (!policy.cover_end || policy.cover_end >= today);
  const valid = ACTIVE_STATUSES.has(policy.status) && inDates;

  const body: VerifyResponse = {
    valid,
    status: valid ? "active" : policy.status === "active" && !inDates ? "outside cover dates" : policy.status.replace(/_/g, " "),
    insurerName: org.name.replace(/\s*\(demo\)\s*$/i, ""),
    coverStart: policy.cover_start,
    coverEnd: policy.cover_end,
    categoryName: category?.name ?? "Insurance policy",
  };
  if (!valid) body.message = `This policy exists but is not currently active (${body.status}).`;
  return Response.json(body, { headers: NO_STORE });
}
