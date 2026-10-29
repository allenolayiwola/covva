import { Suspense } from "react";
import Link from "next/link";
import { StatusPill, Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { OPEN_REQUEST_STATUSES, REQUEST_STATUS, type RequestStatus } from "@im/core";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, ilikeTerm, isUuid, orgMap, pageOf, profileMap, personName, sp, type SearchParams } from "@/lib/query";
import { formatDateTime, relativeDue } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, LoadingBlock, Pagination } from "@/components/ui/layout";

const SOURCES: Enum<"request_source">[] = ["web", "mobile", "whatsapp", "call_centre", "admin", "api"];

export default function RequestsPage({ searchParams }: PageProps<"/requests">) {
  return (
    <>
      <PageHeader title="Requests" description="Every request across brokers, with ownership, SLA and routing. Oversight view — brokers do the work." />
      <Suspense fallback={<LoadingBlock label="Loading requests…" />}>
        <RequestsList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function RequestsList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const [orgs, cats] = await Promise.all([orgMap(supabase), categoryMap(supabase)]);
  const { page, from, to } = pageOf(params);

  const status = sp(params, "status");
  const category = sp(params, "category");
  const broker = sp(params, "broker");
  const source = sp(params, "source");
  const breached = sp(params, "breached") === "1";
  const unassigned = sp(params, "unassigned") === "1";
  const q = sp(params, "q");
  const customer = sp(params, "customer");
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("requests")
    .select("id, reference, title, type, status, source, category_id, broker_org_id, customer_id, due_at, sla_breached_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status && status in REQUEST_STATUS) query = query.eq("status", status as RequestStatus);
  else if (status === "open") query = query.in("status", OPEN_REQUEST_STATUSES);
  if (category) query = query.eq("category_id", category);
  if (broker) query = query.eq("broker_org_id", broker);
  if (source && (SOURCES as string[]).includes(source)) query = query.eq("source", source as Enum<"request_source">);
  if (breached) query = query.in("status", OPEN_REQUEST_STATUSES).or(`sla_breached_at.not.is.null,due_at.lt.${nowIso}`);
  if (unassigned) query = query.is("broker_org_id", null);
  if (q) query = query.or(`reference.ilike.${ilikeTerm(q)},title.ilike.${ilikeTerm(q)}`);

  if (isUuid(customer)) query = query.eq("customer_id", customer);
  const { data, count, error } = await query;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.customer_id));
  const brokers = [...orgs.values()].filter((o) => o.type === "broker");

  return (
    <>
      <FilterBar action="/requests">
        <FilterInput name="q" label="Reference or title" value={q} placeholder="REQ-1001" />
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={[{ value: "open", label: "All open" }, ...Object.entries(REQUEST_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]}
        />
        <FilterSelect name="category" label="Category" value={category} options={[...cats.values()].map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="broker" label="Broker" value={broker} options={brokers.map((b) => ({ value: b.id, label: b.name }))} />
        <FilterSelect name="source" label="Source" value={source} options={SOURCES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
        <FilterCheck name="breached" label="SLA breached" checked={breached} />
        <FilterCheck name="unassigned" label="Unassigned" checked={unassigned} />
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead>
          <tr>
            <Th>Request / customer</Th>
            <Th>Category</Th>
            <Th>Source</Th>
            <Th>Status</Th>
            <Th>Broker of record</Th>
            <Th>Next response</Th>
            <Th>Created</Th>
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => {
            const due = relativeDue(r.due_at);
            const open = OPEN_REQUEST_STATUSES.includes(r.status);
            return (
              <tr key={r.id} className="hover:bg-mist/60">
                <Td>
                  <Link href={`/requests/${r.id}`} className="font-semibold text-ink hover:text-brand">{r.reference}</Link>
                  <span className="text-muted"> · {personName(people.get(r.customer_id), "Customer")}</span>
                  <p className="text-xs text-muted">{r.title ?? r.type.replace("_", " ")}</p>
                </Td>
                <Td>{cats.get(r.category_id)?.name ?? "—"}</Td>
                <Td className="capitalize">{r.source.replace("_", " ")}</Td>
                <Td><StatusPill meta={REQUEST_STATUS[r.status]} /></Td>
                <Td>{r.broker_org_id ? orgs.get(r.broker_org_id)?.name ?? "—" : <Pill tone="wait">Unassigned</Pill>}</Td>
                <Td>
                  {open ? (
                    <>
                      <p className="font-medium text-ink">{due.label}</p>
                      {(due.overdue || r.sla_breached_at) && <p className="text-xs text-danger">SLA breached</p>}
                      {!due.overdue && due.atRisk && <p className="text-xs text-amber">At risk</p>}
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><Td colSpan={7} className="py-10 text-center text-muted">No requests match these filters.</Td></tr>
          )}
        </tbody>
      </Table>
      <Pagination base="/requests" params={params} page={page} total={count} />
    </>
  );
}
