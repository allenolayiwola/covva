"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Reconcile = z.object({
  paymentId: z.string().uuid(),
  value: z.enum(["true", "false"]),
  reason: z.string().trim().min(5, "Add a reconciliation note (at least 5 characters)").max(1000),
});

/**
 * Mark a payment reconciled / unreconciled. Platform staff never move money: this
 * only records that the provider settlement to the insurer matches our records.
 * The note is kept as an internal request event; field changes are audited by trigger.
 */
export async function setReconciled(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Reconcile.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase, staff } = auth;
  const reconciled = parsed.data.value === "true";

  // Bank transfers stay `pending` until someone confirms the credit on the insurer's statement:
  // reconciling one asks the web app to apply the payment (same idempotent path as a webhook).
  if (reconciled) {
    const { data: pending } = await supabase.from("payments").select("id, provider, status").eq("id", parsed.data.paymentId).maybeSingle();
    if (pending?.provider === "bank_transfer" && (pending.status === "pending" || pending.status === "processing")) {
      const confirmed = await confirmBankTransferOnWeb(pending.id, staff.userId, parsed.data.reason);
      if (!confirmed.ok) return fail(confirmed.error);
    }
  }

  const { data: p, error } = await supabase
    .from("payments")
    .update(
      reconciled
        ? { reconciled: true, reconciled_at: new Date().toISOString(), reconciled_by: staff.userId }
        : { reconciled: false, reconciled_at: null, reconciled_by: null },
    )
    .eq("id", parsed.data.paymentId)
    .select("id, request_id, provider_reference, amount")
    .maybeSingle();
  if (error) return fail(dbMessage(error));
  if (!p) return fail("Payment not found or not editable.");

  await supabase.from("request_events").insert({
    request_id: p.request_id,
    actor_id: staff.userId,
    actor_party: "platform",
    event: reconciled ? "payment_reconciled" : "payment_unreconciled",
    note: `Payment ${p.provider_reference ?? p.id} marked ${reconciled ? "reconciled" : "unreconciled"}: ${parsed.data.reason}`,
    visible_to_customer: false,
    data: { payment_id: p.id, amount: p.amount },
  });
  return done(reconciled ? "Payment marked reconciled." : "Payment marked unreconciled.");
}

async function confirmBankTransferOnWeb(paymentId: string, actorId: string, note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!site || !secret) return { ok: false, error: "Cannot confirm a bank transfer: NEXT_PUBLIC_SITE_URL / REVALIDATE_SECRET are not set on the admin app." };
  try {
    const res = await fetch(new URL("/api/payments/confirm-transfer", site), {
      method: "POST",
      headers: { "content-type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ paymentId, actorId, note }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
    if (!res.ok || !json.ok) return { ok: false, error: json.error?.message ?? "The web app could not confirm the bank transfer." };
    return { ok: true };
  } catch {
    return { ok: false, error: "The web app could not be reached to confirm the bank transfer." };
  }
}
