import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Pill, StatusPill, Table, THead, Th, Td } from "@im/ui";
import { POLICY_STATUS, type PolicyStatus } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, ilikeTerm, isUuid, nowMs, orgMap, pageOf, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDate, formatGHS } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, LoadingBlock, Pagination } from "@/components/ui/layout";

export default function PoliciesPage({ searchParams }: PageProps<"/policies">) {
  return (
    <>
      <PageHeader title="Policies" description="The book across the platform. Only the issuing insurer can activate or change cover — this view is read-only." />
      <Suspense fallback={<LoadingBlock label="Loading policies…" />}>
        <PolicyList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PolicyList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const [orgs, cats] = await Promise.all([orgMap(supabase), categoryMap(supabase)]);
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const insurer = sp(params, "insurer");
  const broker = sp(params, "broker");
  const category = sp(params, "category");
  const external = sp(params, "external") === "1";
  const renewing = sp(params, "renewing") === "1";
  const q = sp(params, "q");
  const customer = sp(params, "customer");

  let query = supabase
    .from("policies")
    .select("id, policy_number, internal_reference, status, customer_id, insurer_org_id, broker_org_id, category_id, premium, billing_period, cover_start, cover_end, external_source, issued_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status && status in POLICY_STATUS) query = query.eq("status", status as PolicyStatus);
  if (insurer) query = query.eq("insurer_org_id", insurer);
  if (broker) query = query.eq("broker_org_id", broker);
  if (category) query = query.eq("category_id", category);
  if (external) query = query.eq("external_source", true);
  if (renewing) {
    const today = new Date().toISOString().slice(0, 10);
    const in45 = new Date(nowMs() + 45 * 86_400_000).toISOString().slice(0, 10);
    query = query.eq("status", "active").gte("cover_end", today).lte("cover_end", in45);
  }
  if (q) query = query.or(`policy_number.ilike.${ilikeTerm(q)},internal_reference.ilike.${ilikeTerm(q)},nickname.ilike.${ilikeTerm(q)}`);
  if (isUuid(customer)) query = query.eq("customer_id", customer);
  const { data, count, error } = await query;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.customer_id));
  const all = [...orgs.values()];

  return (
    <>
      <FilterBar action="/policies">
        <FilterInput name="q" label="Policy number / ref" value={q} />
        <FilterSelect name="status" label="Status" value={status} options={Object.entries(POLICY_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FilterSelect name="category" label="Category" value={category} options={[...cats.values()].map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="insurer" label="Insurer" value={insurer} options={all.filter((o) => o.type === "insurer").map((o) => ({ value: o.id, label: o.name }))} />
        <FilterSelect name="broker" label="Broker" value={broker} options={all.filter((o) => o.type === "broker").map((o) => ({ value: o.id, label: o.name }))} />
        <FilterCheck name="renewing" label="Renewing ≤ 45 days" checked={renewing} />
        <FilterCheck name="external" label="Bought elsewhere" checked={external} />
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead>
          <tr><Th>Policy</Th><Th>Customer</Th><Th>Category</Th><Th>Insurer</Th><Th>Broker</Th><Th>Status</Th><Th>Premium</Th><Th>Cover</Th></tr>
        </THead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-mist/60">
              <Td>
                <Link href={`/policies/${p.id}`} className="font-semibold text-ink hover:text-brand">{p.policy_number ?? p.internal_reference}</Link>
                {p.policy_number && <p className="text-xs text-muted">{p.internal_reference}</p>}
                {p.external_source && <Pill tone="neutral" className="mt-1">External</Pill>}
              </Td>
              <Td><Link href={`/users/${p.customer_id}`} className="hover:text-brand">{personName(people.get(p.customer_id))}</Link></Td>
              <Td>{cats.get(p.category_id)?.name}</Td>
              <Td>{orgs.get(p.insurer_org_id)?.name}</Td>
              <Td>{p.broker_org_id ? orgs.get(p.broker_org_id)?.name : "—"}</Td>
              <Td><StatusPill meta={POLICY_STATUS[p.status]} /></Td>
              <Td className="tabular-nums">{formatGHS(p.premium == null ? null : Number(p.premium))}<span className="text-xs text-muted"> /{p.billing_period}</span></Td>
              <Td className="whitespace-nowrap text-xs">{formatDate(p.cover_start)} – {formatDate(p.cover_end)}</Td>
            </tr>
          ))}
          {!rows.length && <tr><Td colSpan={8} className="py-10 text-center text-muted">No policies match.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/policies" params={params} page={page} total={count} />
    </>
  );
}
