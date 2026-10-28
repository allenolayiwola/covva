import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, Notice, PageHeader } from "@im/ui";
import { can, requireKind, ROLES } from "../../../_lib/context";
import { getCategoryMap } from "../../../_lib/data";
import { BulkStatusForm, type BulkProduct } from "@/components/partner/bulk-status-form";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { bulkSetProductStatus } from "../bulk-actions";

export const metadata: Metadata = { title: "Bulk update products" };

export default function BulkPage() {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/products" className="hover:text-brand">Products</Link> <span aria-hidden>›</span> Bulk update
      </nav>
      <PageHeader
        title="Bulk update"
        description="Pause, republish or withdraw several products at once. You see exactly what will change before you confirm, and every change lands in the product's history with your reason."
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
    return <Notice tone="info">Owners, admins and underwriters can change product status. Ask one of them to make this change.</Notice>;
  }
  const [{ data }, cats] = await Promise.all([
    ctx.supabase
      .from("products")
      .select("id, name, code, status, category_id, current_version_id, versions:product_versions!product_versions_product_id_fkey(id, status)")
      .eq("insurer_org_id", ctx.orgId)
      .order("name"),
    getCategoryMap(),
  ]);
  const products: BulkProduct[] = (data ?? []).map((p) => {
    const versions = (p.versions ?? []) as { id: string; status: string }[];
    return { id: p.id, name: p.name, code: p.code, status: p.status, categoryName: cats.get(p.category_id)?.name ?? "—", currentVersionStatus: versions.find((v) => v.id === p.current_version_id)?.status ?? null };
  });
  return (
    <>
      <Section title="Choose products" description="Published products can be paused or withdrawn; paused ones can be republished or withdrawn. Publishing a new product and bringing back a withdrawn one stay with Covva compliance.">
        {products.length ? <BulkStatusForm action={bulkSetProductStatus} products={products} /> : <p className="text-sm text-muted">No products yet.</p>}
      </Section>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
