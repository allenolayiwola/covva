import { z } from "zod";
import type { NextRequest } from "next/server";
import { secretMatches } from "@/server/env";
import { confirmBankTransfer } from "@/server/payments";
import { BusinessRuleError } from "@/server/requests";
import { log } from "@/server/log";

const Input = z.object({ paymentId: z.string().uuid(), actorId: z.string().uuid().optional(), note: z.string().max(1000).optional(), paidAt: z.string().datetime({ offset: true }).optional() });

/**
 * POST /api/payments/confirm-transfer — internal: the admin console (separate deployment) confirms
 * that a bank transfer reached the insurer's account. Shared secret `x-revalidate-secret` (same as
 * /api/revalidate). Applies the pending payment as succeeded through the idempotent webhook path.
 */
export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get("x-revalidate-secret"), process.env.REVALIDATE_SECRET)) {
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Invalid secret" } }, { status: 401 });
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: { code: "invalid_input", message: "paymentId (uuid) is required" } }, { status: 400 });
  try {
    const r = await confirmBankTransfer(parsed.data.paymentId, { actorId: parsed.data.actorId ?? null, note: parsed.data.note ?? null, paidAt: parsed.data.paidAt ?? null });
    return Response.json({ ok: true, data: r });
  } catch (err) {
    if (err instanceof BusinessRuleError) return Response.json({ ok: false, error: { code: err.code, message: err.message } }, { status: err.code === "not_found" ? 404 : 422 });
    log.error("payments.confirm_transfer_failed", { err });
    return Response.json({ ok: false, error: { code: "internal_error", message: "Could not confirm the transfer" } }, { status: 500 });
  }
}
