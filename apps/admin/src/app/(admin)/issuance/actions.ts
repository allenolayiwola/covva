"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, type ActionState } from "@/lib/actions";

/**
 * Re-queue a failed (or stuck queued) issuance job. The web app's `issuance-retry` cron job
 * (every 30 min) re-runs `startIssuance` for queued jobs whose policy is still pending; the
 * admin console does not import the web server code, so it only resets the job here.
 */
export async function retryIssuanceJob(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ jobId: z.string().uuid() }).safeParse({ jobId: fd.get("jobId") });
  if (!parsed.success) return fail("Choose a job to retry.");
  const { data, error } = await auth.supabase
    .from("issuance_jobs")
    .update({ status: "queued", error: null })
    .eq("id", parsed.data.jobId)
    .in("status", ["failed", "queued"])
    .select("id, policy:policies!issuance_jobs_policy_id_fkey(status)")
    .maybeSingle();
  if (error) return fail(dbMessage(error));
  if (!data) return fail("Only failed or queued jobs can be retried.");
  if ((data.policy as unknown as { status: string } | null)?.status !== "pending_issuance") return fail("The policy is no longer awaiting issuance.");
  return done("Job re-queued. The issuance-retry job picks it up within 30 minutes (or run /api/cron/issuance-retry now).");
}
