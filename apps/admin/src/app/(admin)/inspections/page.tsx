import { Suspense } from "react";
import Link from "next/link";
import { Pill, Select } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { assignInspection } from "./actions";

const TONE = { requested: "wait", assigned: "info", scheduled: "info", completed: "ok", failed: "danger" } as const;

export default function InspectionsPage({ searchParams }: PageProps<"/inspections">) {
  return (
    <>
      <PageHeader title="Property inspections" description="Site inspections requested on property cover (homes being built or owned in Ghana). Assign each to an inspection partner; the partner schedules and files the report, and the insurer decides what it means for cover." />
      <Suspense fallback={<LoadingBlock label="Loading inspections…" />}>
        <Inspections searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Inspections({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const canAct = can(staff.roles, "operations");
  const status = sp(params, "status");
  let q = supabase.from("property_inspections").select("*").order("created_at", { ascending: false }).limit(300);
  if (status) q = q.eq("status", status);
  const [{ data: rows }, orgs, { data: partnerOrgs }] = await Promise.all([q, orgMap(supabase), supabase.from("organizations").select("id, name, settings, status").eq("status", "active")]);
  const partners = (partnerOrgs ?? []).filter((o) => (o.settings as { inspection_partner?: boolean } | null)?.inspection_partner === true);
  const list = rows ?? [];
  const requesters = await profileMap(supabase, list.map((i) => i.requested_by));
  const counts = { requested: 0, assigned: 0, scheduled: 0, completed: 0, failed: 0 } as Record<string, number>;
  const { data: all } = status ? await supabase.from("property_inspections").select("status") : { data: list };
  for (const i of all ?? []) counts[i.status] = (counts[i.status] ?? 0) + 1;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Awaiting assignment" value={counts.requested ?? 0} tone={counts.requested ? "warn" : "default"} />
        <Kpi label="Assigned / scheduled" value={(counts.assigned ?? 0) + (counts.scheduled ?? 0)} />
        <Kpi label="Completed" value={counts.completed ?? 0} />
        <Kpi label="Inspection partners" value={partners.length} hint="organizations.settings.inspection_partner" tone={partners.length ? "default" : "warn"} />
      </div>
      <FilterBar action="/inspections">
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "requested", label: "Requested" }, { value: "assigned", label: "Assigned" }, { value: "scheduled", label: "Scheduled" }, { value: "completed", label: "Completed" }, { value: "failed", label: "Failed" }]} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Property</Th><Th>Requested by</Th><Th>Linked to</Th><Th>Status</Th><Th>Partner</Th><Th>Visit</Th><Th /></tr></THead>
        <tbody>
          {list.map((i) => {
            const report = (i.report ?? {}) as { summary?: string };
            return (
              <tr key={i.id}>
                <Td><p className="font-medium text-ink">{i.address ?? "—"}</p><p className="text-xs text-muted">{formatDate(i.created_at)}{i.notes ? ` · ${i.notes.slice(0, 80)}` : ""}</p>{report.summary && <p className="mt-1 text-xs text-ink-2">{report.summary.slice(0, 160)}</p>}</Td>
                <Td className="text-sm">{i.requested_by ? requesters.get(i.requested_by)?.full_name ?? requesters.get(i.requested_by)?.email ?? i.requested_by.slice(0, 8) : "—"}</Td>
                <Td className="text-xs">{i.policy_id ? <Link href={`/policies/${i.policy_id}`} className="text-brand hover:underline">Policy {i.policy_id.slice(0, 8)}</Link> : i.request_id ? <Link href={`/requests/${i.request_id}`} className="text-brand hover:underline">Request {i.request_id.slice(0, 8)}</Link> : "—"}</Td>
                <Td><Pill tone={TONE[i.status as keyof typeof TONE] ?? "neutral"}>{i.status}</Pill></Td>
                <Td className="text-sm">{i.partner_org_id ? orgs.get(i.partner_org_id)?.name ?? i.partner_org_id.slice(0, 8) : "—"}</Td>
                <Td className="text-xs">{i.scheduled_for ? formatDateTime(i.scheduled_for) : i.completed_at ? `done ${formatDate(i.completed_at)}` : "—"}</Td>
                <Td>
                  {canAct && (i.status === "requested" || i.status === "assigned") && (
                    <ActionForm action={assignInspection} submitLabel="Assign" inline audited={false}>
                      <input type="hidden" name="inspectionId" value={i.id} />
                      <Select name="partnerOrgId" defaultValue={i.partner_org_id ?? ""} aria-label="Inspection partner" className="h-9 text-sm">
                        <option value="">Partner…</option>
                        {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            );
          })}
          {!list.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No inspections{status ? ` with status ${status}` : ""}.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
