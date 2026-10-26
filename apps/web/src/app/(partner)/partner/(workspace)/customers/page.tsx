import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar, DemoBadge, EmptyState, Input, PageHeader, Pill, Table, Td, Th, THead } from "@im/ui";
import { OPEN_REQUEST_STATUSES, formatDate, humanize } from "@im/core";
import { requireKind } from "../../_lib/context";
import { fullName, getCustomers } from "../../_lib/data";
import { PageSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage({ searchParams }: PageProps<"/partner/customers">) {
  return (
    <>
      <PageHeader title="Customers" description="Customers whose requests or policies are routed to your organisation." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Customers searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Customers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireKind("broker");
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().toLowerCase() ?? "";

  const [{ data: reqs }, { data: pols }] = await Promise.all([
    ctx.supabase.from("requests").select("customer_id, status, created_at").eq("broker_org_id", ctx.orgId).order("created_at", { ascending: false }).limit(2000),
    ctx.supabase.from("policies").select("customer_id, status").eq("broker_org_id", ctx.orgId).limit(2000),
  ]);
  const ids = [...new Set([...(reqs ?? []).map((r) => r.customer_id), ...(pols ?? []).map((p) => p.customer_id)])];
  const profiles = await getCustomers(ctx, ids);

  let rows = ids.map((id) => {
    const p = profiles.get(id);
    const rr = (reqs ?? []).filter((r) => r.customer_id === id);
    const pp = (pols ?? []).filter((x) => x.customer_id === id);
    return {
      id,
      profile: p,
      name: fullName(p),
      open: rr.filter((r) => OPEN_REQUEST_STATUSES.includes(r.status)).length,
      requests: rr.length,
      active: pp.filter((x) => x.status === "active").length,
      last: rr[0]?.created_at ?? null,
    };
  });
  if (q) {
    rows = rows.filter((r) => [r.name, r.profile?.email, r.profile?.phone, r.profile?.business_name].some((v) => v?.toLowerCase().includes(q)));
  }
  rows.sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));

  return (
    <>
      <form action="/partner/customers" className="mb-4 flex max-w-md gap-2" role="search">
        <label htmlFor="cust-q" className="sr-only">Search customers</label>
        <Input id="cust-q" name="q" defaultValue={q} placeholder="Search by name, email or phone" className="h-10 text-sm" />
        <button className="h-10 rounded-[10px] bg-mint px-4 text-sm font-semibold text-brand-deep">Search</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={q ? "No customers match your search" : "No customers yet"} body="Customers appear here once a request or policy is routed to your organisation." />
      ) : (
        <Table>
          <THead><tr><Th>Customer</Th><Th>Contact</Th><Th>KYC</Th><Th>Requests</Th><Th>Active policies</Th><Th>Last request</Th></tr></THead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-mist/60">
                <Td>
                  <Link href={`/partner/customers/${r.id}`} className="flex items-center gap-3 font-semibold text-ink hover:text-brand">
                    <Avatar name={r.name} size={32} />
                    <span>{r.name}<span className="block text-xs font-normal text-muted">{r.profile ? humanize(r.profile.account_type) : ""}{r.profile?.region ? ` · ${r.profile.region}` : ""}</span></span>
                  </Link>
                </Td>
                <Td><span className="block">{r.profile?.email ?? "—"}</span><span className="text-xs text-muted">{r.profile?.phone ?? ""}</span></Td>
                <Td><Pill tone={r.profile?.kyc_status === "verified" ? "ok" : "wait"}>{humanize(r.profile?.kyc_status ?? "unverified")}</Pill></Td>
                <Td>{r.requests}{r.open > 0 && <span className="ml-1 text-xs text-amber">({r.open} open)</span>}</Td>
                <Td>{r.active}</Td>
                <Td>{formatDate(r.last)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
