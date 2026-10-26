import { Suspense } from "react";
import Link from "next/link";
import { Notice, PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, orgMap, pageOf, profileMap, personName, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock, Pagination, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { decideAppointmentRequest } from "./actions";

const STATUSES = ["admin_review", "pending", "approved", "declined", "revoked"] as const;
const TONE: Record<string, "info" | "wait" | "ok" | "neutral" | "danger"> = { admin_review: "info", pending: "wait", approved: "ok", declined: "neutral", revoked: "danger" };

export default function AppointmentRequestsPage({ searchParams }: PageProps<"/partners/appointments">) {
  return (
    <>
      <PageHeader
        title="Appointment requests"
        description="Brokers asking insurers to appoint them per product line. Requests for insurers on Covva are decided in the insurer portal; letters for insurers not yet on Covva are verified here (the insurer also appears as a partnerships lead)."
      />
      <Suspense fallback={<LoadingBlock label="Loading requests…" />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Requests({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status") ?? "admin_review";
  let query = supabase.from("appointment_requests").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if ((STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  const [{ data, count }, orgs, cats, reviewCount] = await Promise.all([query, orgMap(supabase), categoryMap(supabase), supabase.from("appointment_requests").select("id", { count: "exact", head: true }).eq("status", "admin_review")]);
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.requested_by));
  const letters = rows.filter((r) => r.appointment_letter_path);
  const signed = letters.length ? await supabase.storage.from("documents").createSignedUrls(letters.map((r) => r.appointment_letter_path!), 600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const letterUrl = (path: string | null) => (path ? signed.data?.find((s) => s.path === path)?.signedUrl : undefined);
  const canAct = can(staff.roles, "network");

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="Letters awaiting review" value={reviewCount.count ?? 0} href="/partners/appointments?status=admin_review" tone={(reviewCount.count ?? 0) > 0 ? "warn" : "default"} />
      </div>
      <FilterBar action="/partners/appointments">
        <FilterSelect name="status" label="Status" value={status} allLabel="All" options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
      </FilterBar>
      <ReadOnlyBanner show={!canAct} />
      {status === "admin_review" && !rows.length && <Notice tone="ok" className="mb-4">No appointment letters are waiting for review.</Notice>}
      <Table>
        <THead><tr><Th>Broker</Th><Th>Insurer</Th><Th>Line</Th><Th>Letter</Th><Th>Requested</Th><Th>Status</Th><Th>Decision</Th></tr></THead>
        <tbody>
          {rows.map((r) => {
            const url = letterUrl(r.appointment_letter_path);
            const insurer = r.insurer_org_id ? orgs.get(r.insurer_org_id) : null;
            return (
              <tr key={r.id} className="align-top">
                <Td><Link href={`/organisations/${r.broker_org_id}`} className="font-medium text-ink hover:text-brand">{orgs.get(r.broker_org_id)?.name ?? "Broker"}</Link></Td>
                <Td>
                  {insurer ? <Link href={`/organisations/${insurer.id}`} className="hover:text-brand">{insurer.name}</Link> : <span>{r.proposed_insurer_name} <Pill tone="neutral" className="ml-1">not on Covva</Pill></span>}
                </Td>
                <Td>{cats.get(r.category_id)?.name ?? "—"}</Td>
                <Td>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Open letter</a> : <span className="text-xs text-muted">—</span>}</Td>
                <Td className="text-xs text-muted">{formatDateTime(r.created_at)}<p>{personName(people.get(r.requested_by ?? ""), "")}</p></Td>
                <Td><Pill tone={TONE[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Pill>{r.decision_note && <p className="mt-1 max-w-56 text-xs text-muted">{r.decision_note}</p>}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {(r.status === "admin_review" || r.status === "pending") && (
                      <>
                        <ConfirmAction action={decideAppointmentRequest} fields={{ requestId: r.id, decision: "approve" }} label="Approve" title="Approve this appointment" confirmLabel="Approve" variant="primary" triggerVariant="primary" requireReason={false} disabled={!canAct} body={insurer ? "The broker becomes eligible for this insurer's orders in this line immediately." : "Records the letter as verified. Since the insurer is not on Covva, no routing appointment is created until the insurer joins."} />
                        <ConfirmAction action={decideAppointmentRequest} fields={{ requestId: r.id, decision: "decline" }} label="Decline" title="Decline this request" confirmLabel="Decline" reasonLabel="Reason (sent to the broker)" disabled={!canAct} />
                      </>
                    )}
                    {r.status === "approved" && insurer && (
                      <ConfirmAction action={decideAppointmentRequest} fields={{ requestId: r.id, decision: "revoke" }} label="Revoke" title="Revoke this appointment" confirmLabel="Revoke" reasonLabel="Reason (sent to the broker)" disabled={!canAct} body="The broker loses eligibility for new orders in this line immediately." />
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No requests.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/partners/appointments" params={params} page={page} total={count} />
    </>
  );
}
