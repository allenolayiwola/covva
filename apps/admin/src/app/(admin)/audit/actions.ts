"use server";
import { authorize, dbMessage, fail, type ActionState } from "@/lib/actions";

/** Re-hashes the audit chain in the database (verify_audit_chain RPC). Read-only. */
export async function verifyChain(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("audit");
  if (!auth.ok) return fail(auth.error);
  const limit = Math.min(Math.max(Number(fd.get("limit") ?? 10000) || 10000, 100), 1_000_000);
  const started = Date.now();
  const { data, error } = await auth.supabase.rpc("verify_audit_chain", { p_limit: limit });
  if (error) return fail(dbMessage(error));
  const r = data?.[0];
  if (!r) return fail("No result from verify_audit_chain.");
  return {
    ok: true,
    message: r.ok ? `Chain intact — ${r.checked.toLocaleString("en-GB")} events verified in ${Date.now() - started} ms.` : `Chain BROKEN at event #${r.first_bad_id} (after ${r.checked} checked).`,
    data: { ok: r.ok, checked: r.checked, firstBadId: r.first_bad_id, at: new Date().toISOString() },
  };
}
