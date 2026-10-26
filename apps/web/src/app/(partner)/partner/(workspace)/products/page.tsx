import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, EmptyState, Field, Input, PageHeader, Pill, Select, Table, Td, Th, THead } from "@im/ui";
import { formatDate, humanize } from "@im/core";
import { can, requireKind, ROLES } from "../../_lib/context";
import { getCategoryMap } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { createProduct } from "./actions";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <>
      <PageHeader title="Products" description="Your product data: cover, limits, excesses, exclusions and approved rates. Every change is versioned and approved before use." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Products />
      </Suspense>
    </>
  );
}

const tone = (s: string) => (s === "approved" ? "ok" : s === "pending_approval" ? "wait" : s === "suspended" ? "danger" : "neutral") as "ok" | "wait" | "danger" | "neutral";

async function Products() {
  const ctx = await requireKind("insurer");
  const { data } = await ctx.supabase
    .from("products")
    .select("id, name, code, tier, status, category_id, current_version_id, updated_at, versions:product_versions!product_versions_product_id_fkey(id, version, status, effective_from, approved_at)")
    .eq("insurer_org_id", ctx.orgId)
    .order("name");
  const cats = await getCategoryMap();

  return (
    <>
      {(data ?? []).length === 0 ? <EmptyState title="No products yet" body="Create a product, then submit its first version for approval." /> : (
        <Table>
          <THead><tr><Th>Product</Th><Th>Category</Th><Th>Status</Th><Th>Current version</Th><Th>Pending</Th></tr></THead>
          <tbody>
            {(data ?? []).map((p) => {
              const versions = ((p.versions ?? []) as { id: string; version: number; status: string; effective_from: string; approved_at: string | null }[]).sort((a, b) => b.version - a.version);
              const current = versions.find((v) => v.id === p.current_version_id);
              const pending = versions.filter((v) => v.status === "pending_approval" || v.status === "draft");
              return (
                <tr key={p.id} className="hover:bg-mist/60">
                  <Td><Link href={`/partner/products/${p.id}`} className="font-semibold text-ink hover:text-brand">{p.name}</Link><p className="text-xs text-muted">{p.code}{p.tier ? ` · ${p.tier}` : ""}</p></Td>
                  <Td>{cats.get(p.category_id)?.name ?? "—"}</Td>
                  <Td><Pill tone={tone(p.status)}>{humanize(p.status)}</Pill></Td>
                  <Td>{current ? <>v{current.version} <span className="text-xs text-muted">· approved {formatDate(current.approved_at)}</span></> : "—"}</Td>
                  <Td>{pending.length ? <Pill tone="wait">{pending.map((v) => `v${v.version}`).join(", ")} awaiting approval</Pill> : <span className="text-xs text-subtle">—</span>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {can(ctx, ROLES.underwrite) && (
        <Section className="mt-6" title="Add a product" description="New products start as drafts and aren't shown to customers until a version is approved.">
          <ActionForm action={createProduct} submitLabel="Create product" className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="np-name"><Input id="np-name" name="name" required className="h-10 text-sm" placeholder="Motor Comprehensive Plus" /></Field>
            <Field label="Category" htmlFor="np-cat">
              <Select id="np-cat" name="categoryId" className="h-10 text-sm">
                {[...cats.values()].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Product code" htmlFor="np-code"><Input id="np-code" name="code" required className="h-10 text-sm" placeholder="MOTOR_PLUS" /></Field>
            <Field label="Tier" htmlFor="np-tier"><Input id="np-tier" name="tier" className="h-10 text-sm" placeholder="Plus" /></Field>
            <Field label="Summary" htmlFor="np-sum" className="sm:col-span-2"><Input id="np-sum" name="summary" className="h-10 text-sm" /></Field>
          </ActionForm>
        </Section>
      )}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
