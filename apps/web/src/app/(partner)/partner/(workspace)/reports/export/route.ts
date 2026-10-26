import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/catalog";
import { ORG_COOKIE } from "../../../_lib/context";
import { buildReport, toCsv } from "../../../_lib/reports";
import { ROLES } from "../../../_lib/context";
import { EXPORT_TYPES, exportDataset, parseRange, type AnalyticsClient, type ExportType } from "@/server/partner-analytics";

/**
 * CSV export of partner reports. Authenticated and scoped to the caller's active partner org (RLS applies).
 * `?dataset=` exports the scorecard datasets; `?type=sales|renewals|claims|commission` exports the analytics
 * datasets (commission: owners, admins and finance only).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in required", { status: 401 });

  const { data: memberships } = await supabase
    .from("memberships")
    .select("org_id, role, org:organizations(type, slug)")
    .eq("user_id", auth.user.id)
    .eq("active", true);
  const partner = (memberships ?? []).filter((m) => {
    const t = (m.org as unknown as { type: string } | null)?.type;
    return t === "broker" || t === "insurer";
  });
  if (!partner.length) return new Response("Partner access required", { status: 403 });
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const m = partner.find((x) => x.org_id === wanted) ?? partner[0]!;
  const org = m.org as unknown as { type: "broker" | "insurer"; slug: string };

  const type = req.nextUrl.searchParams.get("type");
  if (type) {
    if (!(EXPORT_TYPES as readonly string[]).includes(type)) return new Response(`Unknown type. Choose one of: ${EXPORT_TYPES.join(", ")}`, { status: 400 });
    if (type === "commission" && !ROLES.billing.includes(m.role)) return new Response("Commission exports are available to owners, admins and finance", { status: 403 });
    const days = parseRange(req.nextUrl.searchParams.get("days"), 30);
    const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.nextUrl.searchParams.get("period") ?? "") ? req.nextUrl.searchParams.get("period")! : undefined;
    try {
      const d = await exportDataset(supabase as unknown as AnalyticsClient, m.org_id, org.type, type as ExportType, days, period);
      return csv(toCsv(d), `${org.slug}-${type}-${type === "commission" ? period ?? "current" : `${days}d`}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      const status = e && typeof e === "object" && "status" in e ? Number((e as { status: number }).status) : 500;
      return new Response(e instanceof Error ? e.message : "Export failed", { status: status >= 400 && status < 600 ? status : 500 });
    }
  }

  const dataset = req.nextUrl.searchParams.get("dataset") ?? "metrics";
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 90));
  const cats = await getCategories();
  const report = await buildReport({ supabase, orgId: m.org_id, kind: org.type, days }, { categories: new Map(cats.map((c) => [c.id, c.name])) });
  const d = report.datasets[dataset];
  if (!d) return new Response(`Unknown dataset. Choose one of: ${Object.keys(report.datasets).join(", ")}`, { status: 400 });

  return csv(toCsv(d), `${org.slug}-${dataset}-${days}d-${new Date().toISOString().slice(0, 10)}.csv`);
}

function csv(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
