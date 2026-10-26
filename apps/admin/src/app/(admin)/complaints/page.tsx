import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Pill, StatusPill, Table, THead, Th, Td } from "@im/ui";
import { COMPLAINT_STATUS, type ComplaintStatus } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, orgMap, pageOf, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime, relativeDue } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, LoadingBlock, Pagination } from "@/components/ui/layout";

export default function ComplaintsPage({ searchParams }: PageProps<"/complaints">) {
  return (
    <>
      <PageHeader title="Complaints" description="All complaints, their owners and resolution deadlines. Unresolved complaints past the deadline can be escalated to the NIC." />
      <Suspense fallback={<LoadingBlock label="Loading complaints…" />}>
        <ComplaintList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ComplaintList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const orgs = await orgMap(supabase);
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const owner = sp(params, "owner");
  const overdue = sp(params, "overdue") === "1";
  const q = sp(params, "q");

  let query = supabase
    .from("complaints")
    .select("id, reference, subject, category, status, against_party, owner_org_id, assigned_to, customer_id, due_at, created_at, escalated_at", { count: "exact" })
    .order("due_at", { ascending: true })
    .range(from, to);
  if (status && status in COMPLAINT_STATUS) query = query.eq("status", status as ComplaintStatus);
  else if (status === "open") query = query.not("status", "in", "(resolved,closed)");
  if (owner) query = query.eq("owner_org_id", owner);
  if (overdue) query = query.not("status", "in", "(resolved,closed)").lt("due_at", new Date().toISOString());
  if (q) query = query.or(`reference.ilike.${ilikeTerm(q)},subject.ilike.${ilikeTerm(q)}`);
  const { data, count, error } = await query;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.flatMap((r) => [r.customer_id, r.assigned_to]));

  return (
    <>
      <FilterBar action="/complaints">
        <FilterInput name="q" label="Reference or subject" value={q} />
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "open", label: "All unresolved" }, ...Object.entries(COMPLAINT_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]} />
        <FilterSelect name="owner" label="Owner organisation" value={owner} options={[...orgs.values()].map((o) => ({ value: o.id, label: o.name }))} />
        <FilterCheck name="overdue" label="Past SLA" checked={overdue} />
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Complaint</Th><Th>Customer</Th><Th>Against</Th><Th>Owner</Th><Th>Status</Th><Th>Resolve by</Th><Th>Opened</Th></tr></THead>
        <tbody>
          {rows.map((c) => {
            const due = relativeDue(c.due_at);
            const unresolved = !["resolved", "closed"].includes(c.status);
            return (
              <tr key={c.id} className="hover:bg-mist/60">
                <Td><Link href={`/complaints/${c.id}`} className="font-semibold text-ink hover:text-brand">{c.reference}</Link><p className="text-xs text-muted">{c.subject}</p></Td>
                <Td>{personName(people.get(c.customer_id))}</Td>
                <Td className="capitalize">{c.against_party}<p className="text-xs text-muted">{c.category}</p></Td>
                <Td>{c.owner_org_id ? orgs.get(c.owner_org_id)?.name : <Pill tone="wait">Unowned</Pill>}{c.assigned_to && <p className="text-xs text-muted">{personName(people.get(c.assigned_to))}</p>}</Td>
                <Td><StatusPill meta={COMPLAINT_STATUS[c.status]} /></Td>
                <Td>{unresolved ? <span className={due.overdue ? "font-medium text-danger" : due.atRisk ? "text-amber" : ""}>{due.overdue ? "Overdue" : due.label}</span> : "—"}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(c.created_at)}</Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={7} className="py-10 text-center text-muted">No complaints.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/complaints" params={params} page={page} total={count} />
    </>
  );
}
