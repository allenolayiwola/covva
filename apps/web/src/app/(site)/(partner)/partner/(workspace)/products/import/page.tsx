import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, Notice, PageHeader } from "@im/ui";
import type { RiskField } from "@im/core";
import { can, requireKind, ROLES } from "../../../_lib/context";
import { getCategoryMap } from "../../../_lib/data";
import { BulkRateImportForm } from "@/components/partner/bulk-rate-import";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { importBulkRateTables } from "../bulk-actions";

export const metadata: Metadata = { title: "Bulk rate import" };

export default function ImportPage() {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/products" className="hover:text-brand">Products</Link> <span aria-hidden>›</span> Bulk rate import
      </nav>
      <PageHeader
        title="Bulk rate import"
        description="Upload one CSV with a product_code column and get a draft rate table per product. The file is checked row by row before anything is created."
      />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const ctx = await requireKind("insurer");
  if (!can(ctx, ROLES.underwrite)) {
    return <Notice tone="info">Owners, admins and underwriters import rate tables. Ask one of them to run this import.</Notice>;
  }
  const [{ data }, cats] = await Promise.all([
    ctx.supabase.from("products").select("id, name, code, category_id").eq("insurer_org_id", ctx.orgId).order("name"),
    getCategoryMap(),
  ]);
  const products = (data ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name, categoryId: p.category_id }));
  // Suggested factor keys: the select/region risk fields shared by the products' categories.
  const fieldSets = [...new Set(products.map((p) => p.categoryId))].map((id) => ((cats.get(id)?.risk_schema ?? []) as unknown as RiskField[]).filter((f) => f.type === "select" || f.type === "region").map((f) => f.key));
  const shared = fieldSets.length ? fieldSets.reduce((acc, keys) => acc.filter((k) => keys.includes(k))) : [];
  const defaultKeys = (shared.length ? shared : fieldSets[0] ?? []).slice(0, 3);

  return (
    <>
      <Section
        title="Upload"
        description="Columns: product_code, your factor keys, rate, then optional rate_kind (rate_on_value, flat, per_unit) and min_premium. Rows for products that are not yours are ignored and listed."
      >
        {products.length ? (
          <BulkRateImportForm action={importBulkRateTables} products={products} defaultFactorKeys={defaultKeys} />
        ) : (
          <p className="text-sm text-muted">Create a product first, then import its rates.</p>
        )}
      </Section>
      <p className="mt-4 text-xs text-muted">
        Tables are drafts attached to each product&apos;s newest draft version (or its current version). Submit them for Covva review and link them to a version&apos;s pricing from the version&apos;s “Rate tables” tab — live prices never change without approval.
      </p>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
