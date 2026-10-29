import { Suspense } from "react";
import Link from "next/link";
import { StatusPill, Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { CATEGORY_AVAILABILITY } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LAUNCH_CHECKLIST } from "@/lib/catalogue";
import { LoadingBlock } from "@/components/ui/layout";
import { Meter } from "@/components/ui/charts";

export default function CategoriesPage() {
  return (
    <>
      <PageHeader
        title="Categories"
        description="Availability is admin-controlled. A category can be integrated only after the seven-item launch gate is complete; unavailable categories stay visible to customers, labelled."
      />
      <Suspense fallback={<LoadingBlock label="Loading categories…" />}>
        <CategoryList />
      </Suspense>
    </>
  );
}

async function CategoryList() {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: cats }, { data: products }] = await Promise.all([
    supabase.from("product_categories").select("id, slug, name, segment, availability, launch_checklist, default_sla_hours, risk_schema, sort_order, regulatory_note").order("sort_order"),
    supabase.from("products").select("category_id, status, insurer_org_id"),
  ]);
  return (
    <Table>
      <THead><tr><Th>Category</Th><Th>Segment</Th><Th>Availability</Th><Th>Launch gate</Th><Th>Products</Th><Th>SLA</Th><Th>Risk fields</Th></tr></THead>
      <tbody>
        {(cats ?? []).map((c) => {
          const lc = (c.launch_checklist as Record<string, boolean> | null) ?? {};
          const done = LAUNCH_CHECKLIST.filter((i) => lc[i.key]).length;
          const prods = (products ?? []).filter((p) => p.category_id === c.id);
          const approved = prods.filter((p) => p.status === "approved");
          return (
            <tr key={c.id} className="hover:bg-mist/60">
              <Td>
                <Link href={`/categories/${c.id}`} className="font-semibold text-ink hover:text-brand">{c.name}</Link>
                <p className="font-mono text-xs text-muted">{c.slug}</p>
                {c.regulatory_note && <Pill tone="wait" className="mt-1">Regulatory note</Pill>}
              </Td>
              <Td className="capitalize">{c.segment}</Td>
              <Td><StatusPill meta={CATEGORY_AVAILABILITY[c.availability]} /></Td>
              <Td className="w-40">
                <p className="mb-1 text-xs text-muted">{done}/7 recorded</p>
                <Meter value={done / 7} />
              </Td>
              <Td className="text-xs">{approved.length} approved · {new Set(approved.map((p) => p.insurer_org_id)).size} insurers<p className="text-muted">{prods.length - approved.length} other</p></Td>
              <Td>{c.default_sla_hours} h</Td>
              <Td>{Array.isArray(c.risk_schema) ? c.risk_schema.length : 0}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
