import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Pill, Table, THead, Th, Td, Tabs } from "@im/ui";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, ilikeTerm, orgMap, pageOf, sp, type SearchParams } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { CATALOGUE_TABS, PRODUCT_TONE } from "./meta";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Pagination } from "@/components/ui/layout";

const STATUSES: Enum<"product_status">[] = ["draft", "pending_approval", "approved", "suspended", "retired"];

export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <>
      <PageHeader title="Products" description="Insurer products and their versions. Every version — wording, limits, excesses, exclusions and rates — needs platform approval before customers see it." />
      <Suspense fallback={<LoadingBlock label="Loading products…" />}>
        <Products searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Products({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const [orgs, cats, { data: pending }] = await Promise.all([
    orgMap(supabase),
    categoryMap(supabase),
    supabase.from("product_versions").select("id, product_id, version, created_at, submitted_by, insurer_approved_at, products!inner(name, insurer_org_id, category_id)").eq("status", "pending_approval").order("created_at"),
  ]);
  const view = sp(params, "view") === "queue" ? "queue" : "all";
  const tabs = <Tabs className="mb-4 w-fit" active={view} items={CATALOGUE_TABS({ queue: pending?.length ?? 0 })} />;

  if (view === "queue") {
    return (
      <>
        {tabs}
        <Table>
          <THead><tr><Th>Product</Th><Th>Insurer</Th><Th>Category</Th><Th>Version</Th><Th>Insurer sign-off</Th><Th>Submitted</Th><Th /></tr></THead>
          <tbody>
            {(pending ?? []).map((v) => {
              const p = v.products as unknown as { name: string; insurer_org_id: string; category_id: string };
              return (
                <tr key={v.id}>
                  <Td className="font-semibold text-ink">{p.name}</Td>
                  <Td>{orgs.get(p.insurer_org_id)?.name}</Td>
                  <Td>{cats.get(p.category_id)?.name}</Td>
                  <Td>v{v.version}</Td>
                  <Td>{v.insurer_approved_at ? <Pill tone="ok">{formatDate(v.insurer_approved_at)}</Pill> : <Pill tone="wait">Missing</Pill>}</Td>
                  <Td className="text-muted">{formatDateTime(v.created_at)}</Td>
                  <Td><Link href={`/products/review/${v.id}`} className="font-semibold text-brand hover:underline">Review →</Link></Td>
                </tr>
              );
            })}
            {!pending?.length && <tr><Td colSpan={7} className="py-10 text-center text-muted">Nothing waiting for review.</Td></tr>}
          </tbody>
        </Table>
      </>
    );
  }

  const { page, from, to } = pageOf(params);
  const insurer = sp(params, "insurer");
  const category = sp(params, "category");
  const status = sp(params, "status");
  const q = sp(params, "q");
  let query = supabase
    .from("products")
    .select("id, name, code, tier, status, insurer_org_id, category_id, current_version_id, updated_at", { count: "exact" })
    .order("category_id")
    .order("name")
    .range(from, to);
  if (insurer) query = query.eq("insurer_org_id", insurer);
  if (category) query = query.eq("category_id", category);
  if (status && (STATUSES as string[]).includes(status)) query = query.eq("status", status as Enum<"product_status">);
  if (q) query = query.or(`name.ilike.${ilikeTerm(q)},code.ilike.${ilikeTerm(q)}`);
  const { data, count } = await query;
  const versionIds = (data ?? []).map((p) => p.current_version_id).filter((x): x is string => !!x);
  const { data: versions } = versionIds.length ? await supabase.from("product_versions").select("id, version, effective_from").in("id", versionIds) : { data: [] };
  const vmap = new Map((versions ?? []).map((v) => [v.id, v]));
  const pendingByProduct = new Set((pending ?? []).map((v) => v.product_id));

  return (
    <>
      {tabs}
      <FilterBar action="/products">
        <FilterInput name="q" label="Name or code" value={q} />
        <FilterSelect name="insurer" label="Insurer" value={insurer} options={[...orgs.values()].filter((o) => o.type === "insurer").map((o) => ({ value: o.id, label: o.name }))} />
        <FilterSelect name="category" label="Category" value={category} options={[...cats.values()].map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="status" label="Status" value={status} options={STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Product</Th><Th>Insurer</Th><Th>Category</Th><Th>Status</Th><Th>Current version</Th><Th>Updated</Th></tr></THead>
        <tbody>
          {(data ?? []).map((p) => {
            const cv = p.current_version_id ? vmap.get(p.current_version_id) : undefined;
            return (
              <tr key={p.id} className="hover:bg-mist/60">
                <Td><Link href={`/products/${p.id}`} className="font-semibold text-ink hover:text-brand">{p.name}</Link><p className="font-mono text-xs text-muted">{p.code}</p></Td>
                <Td>{orgs.get(p.insurer_org_id)?.name}</Td>
                <Td>{cats.get(p.category_id)?.name}</Td>
                <Td><Pill tone={PRODUCT_TONE[p.status]}>{p.status.replace("_", " ")}</Pill>{pendingByProduct.has(p.id) && <Pill tone="wait" className="ml-1">New version pending</Pill>}</Td>
                <Td>{cv ? `v${cv.version} · from ${formatDate(cv.effective_from)}` : "—"}</Td>
                <Td className="text-muted">{formatDate(p.updated_at)}</Td>
              </tr>
            );
          })}
          {!data?.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No products.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/products" params={params} page={page} total={count} />
    </>
  );
}
