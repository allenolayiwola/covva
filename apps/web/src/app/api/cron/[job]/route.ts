import { CRON_JOBS, runCron } from "@/server/cron";
import { secretMatches } from "@/server/env";

export const maxDuration = 300;

/**
 * GET /api/cron/{job} — Vercel Cron (see apps/web/vercel.json). Requires
 * `Authorization: Bearer ${CRON_SECRET}`. Reading the header also keeps this GET dynamic.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/cron/[job]">) {
  const auth = req.headers.get("authorization");
  const { job } = await ctx.params;
  if (!process.env.CRON_SECRET || !secretMatches(auth, `Bearer ${process.env.CRON_SECRET}`)) {
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Invalid cron secret" } }, { status: 401 });
  }
  if (!(job in CRON_JOBS)) return Response.json({ ok: false, error: { code: "not_found", message: `Unknown job ${job}` } }, { status: 404 });
  const result = await runCron(job);
  return Response.json({ ok: !!result?.ok, data: result }, { status: result?.ok ? 200 : 500 });
}
