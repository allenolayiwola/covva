import { isValidSlug } from "@im/core";
import { getArticle, getPage } from "@/server/cms";

/**
 * GET /api/cms/exists?kind=page|article&slug=… → `{ ok: true, data: { exists } }`.
 *
 * Used by the proxy to answer a real 404 for an unknown `/pages/<slug>` or `/learn/<slug>` URL. With Cache
 * Components those routes stream a prerendered shell first, which fixes the status at 200 before the page can
 * call `notFound()` (a "soft 404"); the proxy asks here before the shell is sent. The reads behind it are the
 * same cached CMS lookups the pages use, so the cost is one loopback request on those two routes only.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const slug = sp.get("slug") ?? "";
  if (kind !== "page" && kind !== "article") {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "kind must be page or article" } }, { status: 400 });
  }
  let exists = false;
  if (isValidSlug(slug)) exists = kind === "page" ? !!(await getPage(slug)) : !!(await getArticle(slug));
  return Response.json({ ok: true, data: { exists } }, { headers: { "cache-control": "private, no-store" } });
}
