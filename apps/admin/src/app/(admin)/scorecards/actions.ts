"use server";
import { revalidatePath } from "next/cache";
import type { Json } from "@im/db";
import { SCORECARD_WINDOWS, computeScorecard, parseScorecardInputs, scorecardRow } from "@im/core";
import { authorize, dbMessage, done, fail, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Runs the scorecard refresh now (the same computation as the nightly `scorecard-refresh` cron in the
 * web app): every active or suspended broker gets a 30- and a 90-day card from `broker_scorecard_inputs`.
 * Platform admins only; the upsert needs the service role because the table is read-only for staff.
 */
/** Takes no form input; the form passes (prevState, formData), which a zero-arg action may ignore. */
export async function refreshScorecards(): Promise<ActionState> {
  const auth = await authorize("platform");
  if (!auth.ok) return fail(auth.error);
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    return fail("The service key is not configured for the admin app, so the refresh cannot run from here. Run the scorecard-refresh job instead.");
  }
  const { data: brokers, error } = await svc.from("organizations").select("id").eq("type", "broker").in("status", ["active", "suspended"]).order("id").limit(5000);
  if (error) return fail(dbMessage(error));
  let written = 0;
  let failed = 0;
  const now = new Date();
  for (const b of brokers ?? []) {
    for (const window of SCORECARD_WINDOWS) {
      const { data, error: rpcErr } = await svc.rpc("broker_scorecard_inputs", { p_broker_org_id: b.id, p_days: window });
      if (rpcErr) {
        failed++;
        continue;
      }
      const inputs = parseScorecardInputs(data);
      const card = computeScorecard(inputs);
      const row = scorecardRow({ ...inputs, broker_org_id: b.id, window_days: window }, card, now);
      const { error: upErr } = await svc.from("broker_scorecards").upsert({ ...row, components: row.components as unknown as Json, suggestions: row.suggestions as unknown as Json }, { onConflict: "broker_org_id,window_days" });
      if (upErr) failed++;
      else written++;
    }
  }
  revalidatePath("/scorecards");
  if (!brokers?.length) return done("No active brokers to score yet.");
  return done(`Scorecards refreshed: ${written} written for ${brokers.length} broker${brokers.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`);
}
