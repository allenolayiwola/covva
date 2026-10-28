import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE } from "../../../_lib/context";
import { toCsv } from "../../../_lib/reports";
import { currentMonth, insightDataset, insurerInsightReport, isMonth, previousMonthOf } from "@/server/analytics";
import { renderInsightPdf } from "@/server/insight-pdf";

/**
 * GET /partner/insights/export?month=YYYY-MM&format=csv|pdf — the insurer's anonymised monthly
 * insight report. Authenticated and scoped to the caller's active insurer organisation; the
 * database function applies the membership gate and the small-cell suppression.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in required", { status: 401 });
  const { data: memberships } = await supabase.from("memberships").select("org_id, role, org:organizations(type, slug, name)").eq("user_id", auth.user.id).eq("active", true);
  const insurers = (memberships ?? []).filter((m) => (m.org as unknown as { type: string } | null)?.type === "insurer");
  if (!insurers.length) return new Response("Insurer access required", { status: 403 });
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const m = insurers.find((x) => x.org_id === wanted) ?? insurers[0]!;
  const org = m.org as unknown as { slug: string; name: string };

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = isMonth(monthParam) ? monthParam : previousMonthOf(currentMonth());
  const format = req.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  try {
    const report = await insurerInsightReport(supabase, m.org_id, month);
    if (format === "pdf") {
      const pdf = await renderInsightPdf(report, { name: org.name });
      return new Response(pdf.bytes as BodyInit, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${org.slug}-market-insight-${month}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Sha256": pdf.sha256 },
      });
    }
    return new Response(toCsv(insightDataset(report)), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${org.slug}-market-insight-${month}.csv"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Export failed", { status: 400 });
  }
}
