"use server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Rollup = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
  dry_run: z.string().optional(),
});

/** Runs (or dry-runs) the analytics rollup for a date range: each day's facts are replaced, so backfills are safe to repeat. */
export async function runRollup(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("platform");
  if (!auth.ok) return fail(auth.error);
  const parsed = Rollup.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const dryRun = parsed.data.dry_run === "1";
  // The RPC is service-only; staff session, MFA and platform permission were checked above.
  const { data, error } = await createServiceClient().rpc("analytics_rollup", { p_from: parsed.data.from, p_to: parsed.data.to, p_dry_run: dryRun });
  if (error) return fail(dbMessage(error));
  const r = (data ?? {}) as { days?: number; rows?: number; ms?: number };
  return done(`${dryRun ? "Dry run: would write" : "Wrote"} ${r.rows ?? 0} fact rows for ${r.days ?? 0} day${r.days === 1 ? "" : "s"} in ${r.ms ?? 0} ms.`);
}
