import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, Notice } from "@im/ui";
import type { RatingRule } from "@im/core";
import { QuoteSimulator } from "@/components/partner/quote-simulator";
import { PageSkeleton, TitleSkeleton } from "@/components/partner/ui";
import { VersionHeader } from "@/components/partner/version-nav";
import { loadRateTable, toUnderwritingRule } from "@/server/catalogue";
import { loadVersionPage } from "../../../../_lib";

export const metadata: Metadata = { title: "Quote simulator" };

export default function SimulatePage({ params }: PageProps<"/partner/products/[id]/versions/[versionId]/simulate">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Simulate params={params} />
    </Suspense>
  );
}

async function Simulate({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const { ctx, product, version, riskFields } = await loadVersionPage(id, versionId);
  const rating = (version.rating && Object.keys(version.rating as object).length ? version.rating : null) as unknown as RatingRule | null;
  const [{ data: ruleRows }, table] = await Promise.all([
    ctx.supabase.from("underwriting_rules").select("*").eq("product_version_id", version.id).eq("active", true).order("priority"),
    rating?.model === "rate_table" && rating.rate_table_id ? loadRateTable(ctx.supabase, rating.rate_table_id) : Promise.resolve(null),
  ]);
  const rules = (ruleRows ?? []).map(toUnderwritingRule);
  const effectiveRating = rating?.model === "rate_table" && table ? ({ ...rating, factor_keys: rating.factor_keys?.length ? rating.factor_keys : table.def.factor_keys } as RatingRule) : rating;

  return (
    <>
      <VersionHeader product={product} version={version} active="simulate" isCurrent={product.current_version_id === version.id} />
      {rating?.model === "rate_table" && !table && <Notice tone="danger" className="mb-5">The linked rate table could not be loaded. Link a table under “Rate tables”.</Notice>}
      <QuoteSimulator fields={riskFields} rating={effectiveRating} rows={table?.rows ?? null} rules={rules} issuanceType={version.issuance_type} slaHours={version.sla_hours} tableStatus={table?.table.status ?? null} />
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
