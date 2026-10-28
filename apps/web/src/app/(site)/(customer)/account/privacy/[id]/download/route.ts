import { privacyExportFileName } from "@im/core";
import { STORAGE_BUCKETS } from "@im/db";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ruleMessage } from "@/server/requests";
import { log } from "@/server/log";

/**
 * GET /account/privacy/{id}/download — the customer's personal-data export (Act 843 access request).
 *
 * Never a public link: the signed-in customer is checked, then public.record_privacy_export_download() (run AS the
 * customer, so RLS + ownership + status + expiry are enforced in the database and the download is counted and put on
 * the request's timeline). Only then is the file read from the private bucket with the service client and streamed
 * back with no-store headers. The file lives under privacy-exports/<user>/…, which customers cannot sign themselves.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problem(status: number, message: string) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: Request, ctx: RouteContext<"/account/privacy/[id]/download">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return problem(404, "Not found");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    const next = encodeURIComponent(`/account/privacy`);
    return Response.redirect(new URL(`/sign-in?next=${next}`, req.url), 303);
  }

  const { data, error } = await supabase.rpc("record_privacy_export_download", { p_id: id });
  if (error) return problem(error.code === "P0001" ? 410 : 403, ruleMessage(error, "This download isn't available."));
  const { path, reference } = (data ?? {}) as { path?: string; reference?: string };
  if (!path || !path.startsWith(`privacy-exports/${auth.user.id}/`)) return problem(404, "Not found");

  let file: Blob | null = null;
  try {
    const { data: blob, error: dlError } = await createServiceClient().storage.from(STORAGE_BUCKETS.documents).download(path);
    if (dlError) throw dlError;
    file = blob;
  } catch (err) {
    log.error("privacy.export_download_failed", { requestId: id, err });
    return problem(503, "We couldn't fetch your file just now. Please try again in a few minutes.");
  }

  return new Response(file.stream(), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${privacyExportFileName(reference ?? "export")}"`,
      "cache-control": "no-store, private, max-age=0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
