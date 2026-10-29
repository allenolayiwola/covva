import { Suspense } from "react";
import Link from "next/link";
import { SERVICE_PARTNER_KIND_LABELS, type ServicePartnerKind } from "@im/core";
import { Checkbox, Field, Pill, Select, Textarea } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { decideApplication } from "./actions";

export default function PartnerApplicationsPage({ searchParams }: PageProps<"/service-partners/applications">) {
  return (
    <>
      <PageHeader title="Partner applications" description="Garages, towing services, hospitals, clinics, pharmacies and assessors that applied through /claims/network/join. Check licences before approving; approval creates the directory entry." />
      <Suspense fallback={<LoadingBlock label="Loading applications…" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const TONE = { submitted: "wait", approved: "ok", rejected: "danger" } as const;

async function Queue({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status = sp(params, "status") ?? "submitted";
  const canAct = can(staff.roles, "network");
  const supabase = await createClient();
  let q = supabase.from("service_partner_applications").select("*").order("created_at", { ascending: false }).limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  const rows = data ?? [];
  return (
    <>
      <FilterBar action="/service-partners/applications">
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "submitted", label: "To review" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }]} />
      </FilterBar>
      <ReadOnlyBanner show={!canAct} />
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Applicant</Th><Th>Kind</Th><Th>Region</Th><Th>Contact</Th><Th>Status</Th><Th>Received</Th><Th>Decision</Th></tr></THead>
        <tbody>
          {rows.map((a) => {
            const c = (a.contacts ?? {}) as { contact_name?: string; phone?: string; email?: string | null };
            const docs = (Array.isArray(a.documents) ? a.documents : []) as { name?: string; note?: string }[];
            return (
              <tr key={a.id} className="align-top">
                <Td>
                  <p className="font-semibold text-ink">{a.name}</p>
                  <p className="text-xs text-muted">{a.address}</p>
                  {a.services?.length ? <p className="mt-1 text-xs text-ink-2">{a.services.join(" · ")}</p> : null}
                  {docs.map((d, i) => <p key={i} className="text-xs text-muted">{d.name}: {d.note}</p>)}
                </Td>
                <Td>{SERVICE_PARTNER_KIND_LABELS[a.kind as ServicePartnerKind] ?? a.kind}</Td>
                <Td>{a.region ?? "—"}</Td>
                <Td className="text-xs">{c.contact_name}<br />{c.phone}{c.email ? <><br />{c.email}</> : null}</Td>
                <Td><Pill tone={TONE[a.status as keyof typeof TONE] ?? "neutral"}>{a.status}</Pill>{a.review_note && <p className="mt-1 max-w-48 text-xs text-muted">{a.review_note}</p>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(a.created_at)}</Td>
                <Td className="min-w-64">
                  {a.status === "submitted" ? (
                    <ActionForm action={decideApplication} submitLabel="Record decision" readOnly={!canAct} className="space-y-2">
                      <input type="hidden" name="applicationId" value={a.id} />
                      <Field label="Decision" htmlFor={`d-${a.id}`}>
                        <Select id={`d-${a.id}`} name="decision" defaultValue="approve"><option value="approve">Approve</option><option value="reject">Reject</option></Select>
                      </Field>
                      <Checkbox name="publish" defaultChecked label="Publish to the directory now" />
                      <Field label="Note / reason" htmlFor={`r-${a.id}`}><Textarea id={`r-${a.id}`} name="reason" rows={2} /></Field>
                    </ActionForm>
                  ) : a.service_partner_id ? (
                    <Link href={`/service-partners?id=${a.service_partner_id}`} className="text-sm font-semibold text-brand hover:underline">Open partner</Link>
                  ) : null}
                </Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={7} className="text-muted">No applications.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
