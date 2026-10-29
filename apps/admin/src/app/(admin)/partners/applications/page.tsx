import { Suspense } from "react";
import Link from "next/link";
import { Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { applicationCompleteness, type PartnerApplicationInput } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, pageOf, profileMap, personName, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, Kpi, LoadingBlock, Pagination } from "@/components/ui/layout";
import { STATUSES, STATUS_TONE } from "./meta";

export default function ApplicationsPage({ searchParams }: PageProps<"/partners/applications">) {
  return (
    <>
      <PageHeader title="Partner applications" description="Self-service insurer and broker registrations. Verify the NIC licence against the register, check the documents and the e-signed agreement, then approve, return with notes or reject." />
      <Suspense fallback={<LoadingBlock label="Loading applications…" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status") ?? "open";
  const type = sp(params, "type");
  const q = sp(params, "q");
  let query = supabase.from("partner_applications").select("*", { count: "exact" }).order("submitted_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(from, to);
  if (status === "open") query = query.in("status", ["submitted", "in_review", "needs_changes"]);
  else if ((STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  if (type === "insurer" || type === "broker") query = query.eq("type", type);
  if (q) query = query.or(`company_name.ilike.${ilikeTerm(q)},nic_licence_number.ilike.${ilikeTerm(q)},legal_name.ilike.${ilikeTerm(q)}`);
  const [{ data, count }, ...counts] = await Promise.all([query, ...STATUSES.slice(0, 3).map((s) => supabase.from("partner_applications").select("id", { count: "exact", head: true }).eq("status", s))]);
  const people = await profileMap(supabase, (data ?? []).map((a) => a.applicant_user_id));

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {STATUSES.slice(0, 3).map((s, i) => (
          <Kpi key={s} label={s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())} value={counts[i]?.count ?? 0} href={`/partners/applications?status=${s}`} tone={s === "submitted" && (counts[i]?.count ?? 0) > 0 ? "warn" : "default"} />
        ))}
      </div>
      <FilterBar action="/partners/applications">
        <FilterInput name="q" label="Company or licence number" value={q} />
        <FilterSelect name="status" label="Status" value={status === "open" ? "" : status} allLabel="Open (submitted, in review, needs changes)" options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
        <FilterSelect name="type" label="Type" value={type} options={[{ value: "insurer", label: "Insurer" }, { value: "broker", label: "Broker" }]} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Company</Th><Th>Type</Th><Th>NIC licence</Th><Th>Applicant</Th><Th>Completeness</Th><Th>Status</Th><Th>Submitted</Th></tr></THead>
        <tbody>
          {(data ?? []).map((a) => {
            const c = applicationCompleteness(a as unknown as PartnerApplicationInput);
            const p = people.get(a.applicant_user_id);
            return (
              <tr key={a.id}>
                <Td>
                  <Link href={`/partners/applications/${a.id}`} className="font-semibold text-ink hover:text-brand">{a.company_name ?? "Untitled application"}</Link>
                  {a.legal_name && <p className="text-xs text-muted">{a.legal_name}</p>}
                </Td>
                <Td className="capitalize">{a.type}</Td>
                <Td className="font-mono text-xs">{a.nic_licence_number ?? "—"}{a.nic_licence_expires_on && <p className="font-sans text-muted">expires {a.nic_licence_expires_on}</p>}</Td>
                <Td><p className="text-sm text-ink">{personName(p)}</p><p className="text-xs text-muted">{p?.email ?? ""}</p></Td>
                <Td>{c.complete ? <Pill tone="ok">Complete</Pill> : <Pill tone="wait">{c.missing.length} missing</Pill>}</Td>
                <Td><Pill tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status.replace(/_/g, " ")}</Pill></Td>
                <Td className="whitespace-nowrap text-xs text-muted">{a.submitted_at ? formatDateTime(a.submitted_at) : "—"}</Td>
              </tr>
            );
          })}
          {!data?.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No applications match these filters.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/partners/applications" params={params} page={page} total={count} />
    </>
  );
}
