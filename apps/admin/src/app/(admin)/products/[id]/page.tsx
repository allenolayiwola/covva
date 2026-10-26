import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import type { RatingRule, RiskField } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, personName, profileMap } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { Breadcrumb, KeyValues, LoadingBlock, Panel } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { PRODUCT_TONE } from "../meta";
import { TestPricePanel } from "../TestPricePanel";
import { setProductStatus } from "../actions";

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading product…" />}>
      <Product params={params} />
    </Suspense>
  );
}

async function Product({ params }: Pick<PageProps<"/products/[id]">, "params">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: p } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [{ data: versions }, { data: insurer }, { data: category }] = await Promise.all([
    supabase.from("product_versions").select("*").eq("product_id", id).order("version", { ascending: false }),
    supabase.from("organizations").select("id, name").eq("id", p.insurer_org_id).single(),
    supabase.from("product_categories").select("id, name, risk_schema").eq("id", p.category_id).single(),
  ]);
  const people = await profileMap(supabase, [p.data_owner_id, ...(versions ?? []).flatMap((v) => [v.submitted_by, v.approved_by])]);
  const current = (versions ?? []).find((v) => v.id === p.current_version_id);
  const canAct = can(staff.roles, "productApproval");
  const fields = (Array.isArray(category?.risk_schema) ? category.risk_schema : []) as unknown as RiskField[];

  const statusActions = (["suspended", "retired", "approved"] as const).filter((s) => s !== p.status && !(s === "approved" && p.status === "draft"));
  return (
    <>
      <Breadcrumb items={[{ label: "Products", href: "/products" }, { label: p.name }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{p.name} <Pill tone={PRODUCT_TONE[p.status]}>{p.status.replace("_", " ")}</Pill></span>}
        description={`${insurer?.name ?? ""} · ${category?.name ?? ""} · ${p.code}`}
        actions={statusActions.map((s) => (
          <ConfirmAction
            key={s}
            action={setProductStatus}
            fields={{ productId: p.id, status: s }}
            label={{ suspended: "Suspend", retired: "Retire", approved: "Reinstate" }[s]}
            title={`${{ suspended: "Suspend", retired: "Retire", approved: "Reinstate" }[s]} ${p.name}`}
            variant={s === "approved" ? "primary" : "danger"}
            confirmWord={s === "retired" ? "RETIRE" : undefined}
            disabled={!canAct}
            body={
              s === "suspended"
                ? "Suspended products disappear from comparison immediately. Existing policies are unaffected."
                : s === "retired"
                  ? "Retired products are permanently withdrawn from sale. Existing policies and history are kept."
                  : "Reinstating makes the current approved version available for comparison again."
            }
          />
        ))}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Versions" bodyClassName="p-0">
            <Table className="rounded-none border-0">
              <THead><tr><Th>Version</Th><Th>Status</Th><Th>Effective</Th><Th>Submitted</Th><Th>Approved</Th><Th /></tr></THead>
              <tbody>
                {(versions ?? []).map((v) => (
                  <tr key={v.id}>
                    <Td className="font-semibold">v{v.version}{v.id === p.current_version_id && <Pill tone="ok" className="ml-2">Current</Pill>}</Td>
                    <Td><Pill tone={PRODUCT_TONE[v.status]}>{v.status.replace("_", " ")}</Pill></Td>
                    <Td className="text-xs">{formatDate(v.effective_from)} – {v.effective_to ? formatDate(v.effective_to) : "open"}</Td>
                    <Td className="text-xs">{formatDateTime(v.created_at)}{v.submitted_by && <p className="text-muted">{personName(people.get(v.submitted_by))}</p>}</Td>
                    <Td className="text-xs">{v.approved_at ? formatDateTime(v.approved_at) : "—"}{v.approved_by && <p className="text-muted">{personName(people.get(v.approved_by))}</p>}</Td>
                    <Td><Link href={`/products/review/${v.id}`} className="text-sm text-brand hover:underline">{v.status === "pending_approval" ? "Review →" : "View"}</Link></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          {current && (
            <Panel title={`Test pricing — current v${current.version}`}>
              <TestPricePanel fields={fields} current={current.rating as unknown as RatingRule} proposed={null} />
            </Panel>
          )}
        </div>
        <Panel title="Product">
          <KeyValues
            items={[
              { label: "Insurer", value: insurer ? <Link href={`/organisations/${insurer.id}`} className="text-brand hover:underline">{insurer.name}</Link> : "—" },
              { label: "Category", value: category ? <Link href={`/categories/${category.id}`} className="text-brand hover:underline">{category.name}</Link> : "—" },
              { label: "Tier", value: p.tier ?? "—" },
              { label: "Data owner", value: p.data_owner_id ? personName(people.get(p.data_owner_id)) : "Not named" },
              { label: "Summary", value: p.summary ?? "—" },
              { label: "Updated", value: formatDateTime(p.updated_at) },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
