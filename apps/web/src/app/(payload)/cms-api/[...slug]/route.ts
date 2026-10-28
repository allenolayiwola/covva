import config from "@payload-config";
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from "@payloadcms/next/routes";
import { cmsConfigured, cmsDisabledReason } from "@/cms/env";

/**
 * Payload REST API (/cms-api/*), used by the admin UI. The site itself reads through the Local
 * API and never calls this. Answers 503 when the CMS is not configured.
 */
type Handler = (req: Request, ctx: { params: Promise<{ slug: string[] }> }) => Promise<Response>;

const disabled = () =>
  Response.json({ errors: [{ message: `CMS is not configured: ${cmsDisabledReason()}` }] }, { status: 503, headers: { "cache-control": "no-store" } });

const guard = (handler: Handler): Handler => (req, ctx) => (cmsConfigured() ? handler(req, ctx) : Promise.resolve(disabled()));

export const GET = guard(REST_GET(config) as Handler);
export const POST = guard(REST_POST(config) as Handler);
export const DELETE = guard(REST_DELETE(config) as Handler);
export const PATCH = guard(REST_PATCH(config) as Handler);
export const PUT = guard(REST_PUT(config) as Handler);
export const OPTIONS = guard(REST_OPTIONS(config) as Handler);
