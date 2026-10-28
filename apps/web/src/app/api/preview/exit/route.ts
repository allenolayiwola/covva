import { cookies, draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { PREVIEW_COOKIE } from "@/components/marketing/preview-banner";

/** GET /api/preview/exit[?path=/] — leave editor preview (draft mode) and go back to the published site. */
export async function GET(req: Request) {
  const rawPath = new URL(req.url).searchParams.get("path") ?? "/";
  const path = /^\/(?!\/)[\w\-./]*$/.test(rawPath) ? rawPath : "/";
  (await draftMode()).disable();
  (await cookies()).delete(PREVIEW_COOKIE);
  redirect(path);
}
