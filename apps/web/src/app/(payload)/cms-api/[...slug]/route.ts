import config from "@payload-config";
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from "@payloadcms/next/routes";
import { cmsBootstrapState } from "@/cms/bootstrap";
import { cmsConfigured, cmsDisabledReason } from "@/cms/env";

/**
 * Payload REST API (/cms-api/*), used by the admin UI. The site itself reads through the Local
 * API and never calls this. Answers 503 when the CMS is not configured, and also while it has no
 * user yet (cms/bootstrap.ts), so `POST /cms-api/users/first-register` is never reachable: the
 * first admin comes from `cms:seed`.
 */
type Handler = (req: Request, ctx: { params: Promise<{ slug: string[] }> }) => Promise<Response>;

const unavailable = (message: string) => Response.json({ errors: [{ message }] }, { status: 503, headers: { "cache-control": "no-store" } });

const REASONS = {
  uninitialised: "CMS is not initialised: no CMS user exists yet. Create the first admin with `pnpm --filter @im/web cms:seed` (docs/CMS.md).",
  unavailable: "CMS is unavailable: the CMS database could not be reached.",
} as const;

const guard =
  (handler: Handler): Handler =>
  async (req, ctx) => {
    if (!cmsConfigured()) return unavailable(`CMS is not configured: ${cmsDisabledReason()}`);
    const state = await cmsBootstrapState();
    if (state !== "ready") return unavailable(REASONS[state]);
    return handler(req, ctx);
  };

export const GET = guard(REST_GET(config) as Handler);
export const POST = guard(REST_POST(config) as Handler);
export const DELETE = guard(REST_DELETE(config) as Handler);
export const PATCH = guard(REST_PATCH(config) as Handler);
export const PUT = guard(REST_PUT(config) as Handler);
export const OPTIONS = guard(REST_OPTIONS(config) as Handler);
