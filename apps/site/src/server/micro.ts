import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  microProducts,
  ratePremium,
  supportedPeriods,
  type MicroProductCard,
  type PolicyPeriod,
  type RatingRule,
  type RiskData,
} from "@im/core";
import type { Database, Row } from "@im/db";
import type { createServiceClient } from "@/lib/supabase/server";
import { quoteVersion } from "@/server/catalogue";
import { planDb, type VersionPlanColumns } from "@/server/plan-db";

/**
 * Micro-insurance listing for the public /micro page. Buying, renewing and the WhatsApp / USSD channels
 * live in the app (apps/web/src/server/micro.ts); this file keeps only the read side the site needs.
 */
type Svc = ReturnType<typeof createServiceClient>;
type AnyClient = SupabaseClient<Database>;
type VersionRow = Row<"product_versions"> & VersionPlanColumns;

/** Premium per period for a version (rate tables resolved), from the insurer's `period_factors` or pro rata. */
export async function microPricing(client: AnyClient, version: Pick<VersionRow, "rating" | "periods">, risk: RiskData = {}): Promise<Partial<Record<PolicyPeriod, number>>> {
  const rule = version.rating as unknown as RatingRule & { period_factors?: unknown; period_min_premium?: unknown };
  const periods = supportedPeriods(version.periods);
  if (!rule || !periods.length) return {};
  if (rule.model === "rate_table") {
    const annual = await quoteVersion(client as Svc, rule, risk);
    if (!annual.ok) return {};
    return ratePremium({ model: "flat", amount: annual.premium, period_factors: rule.period_factors, period_min_premium: rule.period_min_premium } as unknown as RatingRule, {}, { periods }).byPeriod ?? {};
  }
  const r = ratePremium(rule, risk, { periods });
  return r.ok ? r.byPeriod ?? {} : {};
}

/** Published micro products (current approved version of an approved product), optionally for one audience. */
export async function listMicroProducts(client: AnyClient, audience?: string | null): Promise<MicroProductCard[]> {
  const db = planDb(client as Svc);
  const { data: versions } = await db.from("product_versions").select("*").eq("micro", true).eq("status", "approved").limit(200);
  if (!versions?.length) return [];
  const { data: products } = await client.from("products").select("id, name, insurer_org_id, category_id, status, current_version_id").in("id", [...new Set(versions.map((v) => v.product_id))]).eq("status", "approved");
  const live = (products ?? []).filter((p) => versions.some((v) => v.id === p.current_version_id));
  if (!live.length) return [];
  const [{ data: insurers }, { data: categories }] = await Promise.all([
    client.from("organizations").select("id, name").in("id", [...new Set(live.map((p) => p.insurer_org_id))]),
    client.from("product_categories").select("id, slug").in("id", [...new Set(live.map((p) => p.category_id))]),
  ]);
  const rows = await Promise.all(
    live.map(async (p) => {
      const v = versions.find((x) => x.id === p.current_version_id)!;
      const coverage = Array.isArray(v.coverage) ? (v.coverage as { label?: string; title?: string }[]) : [];
      return {
        versionId: v.id,
        productName: p.name,
        insurerName: (insurers ?? []).find((i) => i.id === p.insurer_org_id)?.name ?? "Insurer",
        categorySlug: (categories ?? []).find((c) => c.id === p.category_id)?.slug ?? null,
        micro: true,
        audienceTags: v.audience_tags ?? [],
        periods: v.periods ?? [],
        byPeriod: await microPricing(client, v),
        summary: coverage.map((c) => c.label ?? c.title).filter(Boolean).slice(0, 3).join(" · ") || v.key_exclusion || null,
      };
    }),
  );
  return microProducts(rows, audience);
}

