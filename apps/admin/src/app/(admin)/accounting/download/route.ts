import type { NextRequest } from "next/server";
import { resolveStaff } from "@/lib/auth";
import { signedExportUrl } from "@/lib/accounting";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/query";

/** GET /accounting/download?id= — staff download of a stored accounting export (10-minute signed URL). */
export async function GET(request: NextRequest) {
  const r = await resolveStaff();
  if (r.status !== "ok") return new Response("Not authorised", { status: r.status === "anonymous" ? 401 : 403 });
  const id = request.nextUrl.searchParams.get("id") ?? undefined;
  if (!isUuid(id)) return new Response("Unknown export", { status: 400 });
  const supabase = await createClient();
  const { data } = await supabase.from("accounting_exports").select("storage_path, status").eq("id", id).maybeSingle();
  const url = data?.status === "ready" && data.storage_path ? await signedExportUrl(data.storage_path) : null;
  return url ? Response.redirect(url, 303) : new Response("Export not found", { status: 404 });
}
