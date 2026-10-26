import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/catalog";
import { ORG_COOKIE } from "../../../_lib/context";
import { buildReport, toCsv } from "../../../_lib/reports";

/** CSV export of partner reports. Authenticated and scoped to the caller's active partner org (RLS applies). */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in required", { status: 401 });

  const { data: memberships } = await supabase
    .from("memberships")
    .select("org_id, org:organizations(type, slug)")
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

  const dataset = req.nextUrl.searchParams.get("dataset") ?? "metrics";
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 90));
  const cats = await getCategories();
  const report = await buildReport({ supabase, orgId: m.org_id, kind: org.type, days }, { categories: new Map(cats.map((c) => [c.id, c.name])) });
  const d = report.datasets[dataset];
  if (!d) return new Response(`Unknown dataset. Choose one of: ${Object.keys(report.datasets).join(", ")}`, { status: 400 });

  const filename = `${org.slug}-${dataset}-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(toCsv(d), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
