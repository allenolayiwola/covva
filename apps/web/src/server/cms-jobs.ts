import "server-only";
import { cmsConfigured } from "@/cms/env";

/**
 * Runs Payload's job queue (scheduled publish / unpublish of CMS documents). Called by the
 * `cms-jobs` Vercel cron every 15 minutes; a no-op on deployments without the CMS.
 */
export async function runCmsJobs(): Promise<Record<string, unknown>> {
  if (!cmsConfigured()) return { ok: true, skipped: "cms not configured" };
  const { getPayloadClient } = await import("@/cms/client");
  const payload = await getPayloadClient();
  const result = await payload.jobs.run({ allQueues: true, limit: 25 });
  const stats = (result as { jobStatus?: Record<string, { status: string }> }).jobStatus ?? {};
  const ran = Object.values(stats);
  return { ok: true, ran: ran.length, failed: ran.filter((j) => j.status === "error").length };
}
