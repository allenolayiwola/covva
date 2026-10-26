import { Suspense } from "react";
import Link from "next/link";
import { Gavel } from "lucide-react";
import { Notice, PageHeader, StatusPill, Table, THead, Th, Td, Pill } from "@im/ui";
import { CLAIM_STATUS, type ClaimStatus } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, orgMap, pageOf, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime, formatGHS } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, LoadingBlock, Pagination } from "@/components/ui/layout";
import { claimSla } from "./sla";

export default function ClaimsPage({ searchParams }: PageProps<"/claims">) {
  return (
    <>
      <PageHeader title="Claims" description="Oversight of claim progress and service levels across insurers." />
      <Notice tone="info" icon={<Gavel className="size-4" />} title="Claim decisions are insurer-only" className="mb-5">
        Only the insurer can approve, reject or pay a claim (enforced in the database). Reporting a claim is not approval. Platform staff
        monitor status and SLAs here and escalate through the broker and insurer.
      </Notice>
      <Suspense fallback={<LoadingBlock label="Loading claims…" />}>
        <ClaimList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ClaimList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const orgs = await orgMap(supabase);
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const insurer = sp(params, "insurer");
  const open = sp(params, "open") === "1";
  const q = sp(params, "q");

  let query = supabase
    .from("claims")
    .select("id, reference, status, incident_type, customer_id, insurer_org_id, broker_org_id, amount_claimed, decision_amount, reported_at, delivered_to_insurer_at, acknowledged_at, decision_at, paid_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status && status in CLAIM_STATUS) query = query.eq("status", status as ClaimStatus);
  if (insurer) query = query.eq("insurer_org_id", insurer);
  if (open) query = query.not("status", "in", "(draft,paid,closed,withdrawn,rejected)");
  if (q) query = query.ilike("reference", ilikeTerm(q));
  const { data, count, error } = await query;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.customer_id));

  return (
    <>
      <FilterBar action="/claims">
        <FilterInput name="q" label="Reference" value={q} placeholder="CLM-501" />
        <FilterSelect name="status" label="Status" value={status} options={Object.entries(CLAIM_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FilterSelect name="insurer" label="Insurer" value={insurer} options={[...orgs.values()].filter((o) => o.type === "insurer").map((o) => ({ value: o.id, label: o.name }))} />
        <FilterCheck name="open" label="Open only" checked={open} />
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Claim</Th><Th>Customer</Th><Th>Insurer / broker</Th><Th>Status</Th><Th>Claimed</Th><Th>Service level</Th><Th>Reported</Th></tr></THead>
        <tbody>
          {rows.map((c) => {
            const sla = claimSla(c);
            return (
              <tr key={c.id} className="hover:bg-mist/60">
                <Td><Link href={`/claims/${c.id}`} className="font-semibold text-ink hover:text-brand">{c.reference}</Link><p className="text-xs text-muted">{c.incident_type}</p></Td>
                <Td>{personName(people.get(c.customer_id))}</Td>
                <Td>{orgs.get(c.insurer_org_id)?.name}<p className="text-xs text-muted">{c.broker_org_id ? orgs.get(c.broker_org_id)?.name : "No broker"}</p></Td>
                <Td><StatusPill meta={CLAIM_STATUS[c.status]} /></Td>
                <Td className="tabular-nums">{formatGHS(c.amount_claimed == null ? null : Number(c.amount_claimed))}</Td>
                <Td>{sla ? <Pill tone={sla.tone}>{sla.label}</Pill> : <span className="text-muted">—</span>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(c.reported_at)}</Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={7} className="py-10 text-center text-muted">No claims.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/claims" params={params} page={page} total={count} />
    </>
  );
}
