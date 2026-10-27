import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { monthPeriod } from "@im/core";
import { createClient } from "@/lib/supabase/server";
import { EXPORTS_FOR, exportDownloadUrl, isExportKind, runExport } from "@/server/accounting";
import { ORG_COOKIE } from "../../../../_lib/context";

/**
 * GET /partner/reports/accounting/download?kind=<kind>&month=YYYY-MM — generate an accounting export for
 * the active partner organisation (owners, admins and finance) and redirect to a 10-minute signed URL.
 * `?id=<export id>` re-downloads a stored export (the row is read through RLS first).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in required", { status: 401 });
  const { data: memberships } = await supabase.from("memberships").select("org_id, role, org:organizations(type)").eq("user_id", auth.user.id).eq("active", true);
  const partner = (memberships ?? []).filter((m) => ["broker", "insurer"].includes((m.org as unknown as { type: string } | null)?.type ?? ""));
  if (!partner.length) return new Response("Partner access required", { status: 403 });
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const m = partner.find((x) => x.org_id === wanted) ?? partner[0]!;
  if (!["owner", "admin", "finance"].includes(m.role)) return new Response("Owners, admins and finance only", { status: 403 });
  const type = (m.org as unknown as { type: "broker" | "insurer" }).type;

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Unknown export", { status: 400 });
    const { data: row } = await supabase.from("accounting_exports").select("id, org_id").eq("id", id).maybeSingle();
    const url = row ? await exportDownloadUrl(row.id, (r) => r.org_id === m.org_id) : null;
    return url ? Response.redirect(url, 303) : new Response("Export not found", { status: 404 });
  }

  const kind = req.nextUrl.searchParams.get("kind");
  const period = monthPeriod(req.nextUrl.searchParams.get("month") ?? "");
  if (!isExportKind(kind) || !EXPORTS_FOR[type].includes(kind)) return new Response("This export isn't available for your organisation", { status: 400 });
  if (!period) return new Response("Choose a month", { status: 400 });
  const result = await runExport(kind, m.org_id, period, { createdBy: auth.user.id });
  if (result.status !== "ready" || !result.url) return new Response(`The export failed: ${result.error ?? "unknown error"}`, { status: 500 });
  return Response.redirect(result.url, 303);
}
