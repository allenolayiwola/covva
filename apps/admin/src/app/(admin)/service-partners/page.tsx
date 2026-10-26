import { Suspense } from "react";
import { Wrench } from "lucide-react";
import { Checkbox, Field, Input, Notice, PageHeader, Pill, Select, Table, THead, Th, Td, Textarea } from "@im/ui";
import { SERVICE_PARTNER_KIND_LABELS, SERVICE_PARTNER_KINDS, type ServicePartnerKind } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, orgMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { saveServicePartner, setServicePartnerStatus } from "./actions";

export default function ServicePartnersPage({ searchParams }: PageProps<"/service-partners">) {
  return (
    <>
      <PageHeader title="Service partners" description="Post-claim network: garages, towing, hospitals, clinics, pharmacies and assessors. Approved partners appear on the public directory and can be assigned to claims." />
      <Notice tone="info" icon={<Wrench className="size-4" />} title="Direct billing" className="mb-5">
        Tick the insurers a partner has a direct-billing agreement with. Customers then see &ldquo;Direct billing — you don&apos;t pay upfront&rdquo; for that partner on their claim, and the insurer settles the partner&apos;s invoice. Ratings and job history come later.
      </Notice>
      <Suspense fallback={<LoadingBlock label="Loading partners…" />}>
        <Directory searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_TONE = { pending: "wait", approved: "ok", suspended: "danger" } as const;

async function Directory({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const orgs = await orgMap(supabase);
  const insurers = [...orgs.values()].filter((o) => o.type === "insurer" && o.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  const kind = sp(params, "kind");
  const status = sp(params, "status");
  const region = sp(params, "region");
  const q = sp(params, "q");
  const edit = sp(params, "edit");
  const canAct = can(staff.roles, "network");

  let query = supabase.from("service_partners").select("*").order("status").order("region").order("name").limit(300);
  if (kind) query = query.eq("kind", kind);
  if (status) query = query.eq("status", status);
  if (region) query = query.ilike("region", ilikeTerm(region));
  if (q) query = query.ilike("name", ilikeTerm(q));
  const { data, error } = await query;
  const rows = data ?? [];
  const editing = edit ? rows.find((r) => r.id === edit) : undefined;

  return (
    <>
      <FilterBar action="/service-partners">
        <FilterInput name="q" label="Name" value={q} placeholder="Garage name" />
        <FilterSelect name="kind" label="Kind" value={kind} options={SERVICE_PARTNER_KINDS.map((k) => ({ value: k, label: SERVICE_PARTNER_KIND_LABELS[k] }))} />
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "suspended", label: "Suspended" }]} />
        <FilterInput name="region" label="Region" value={region} placeholder="Greater Accra" />
      </FilterBar>
      <ReadOnlyBanner show={!canAct} />
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Table>
          <THead><tr><Th>Partner</Th><Th>Kind</Th><Th>Region</Th><Th>Direct billing</Th><Th>Status</Th><Th>Added</Th><Th>&nbsp;</Th></tr></THead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-mist/60">
                <Td>
                  <a href={`/service-partners?edit=${p.id}${kind ? `&kind=${kind}` : ""}${status ? `&status=${status}` : ""}`} className="font-semibold text-ink hover:text-brand">{p.name}</a>
                  <p className="text-xs text-muted">{[p.address, p.phone].filter(Boolean).join(" · ")}</p>
                </Td>
                <Td>{SERVICE_PARTNER_KIND_LABELS[p.kind as ServicePartnerKind] ?? p.kind}</Td>
                <Td>{p.region ?? "—"}</Td>
                <Td className="text-xs">{(p.direct_billing_insurer_ids ?? []).map((id) => orgs.get(id)?.name).filter(Boolean).join(", ") || <span className="text-muted">None</span>}</Td>
                <Td><Pill tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE] ?? "neutral"}>{p.status}</Pill></Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(p.created_at)}</Td>
                <Td>
                  {canAct && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.status !== "approved" && <ConfirmAction action={setServicePartnerStatus} fields={{ partnerId: p.id, status: "approved" }} label="Approve" title={`Approve ${p.name}`} body="Publishes the partner on the public directory and makes it assignable to claims." confirmLabel="Approve" variant="primary" requireReason={false} />}
                      {p.status !== "suspended" && <ConfirmAction action={setServicePartnerStatus} fields={{ partnerId: p.id, status: "suspended" }} label="Suspend" title={`Suspend ${p.name}`} body="Removes the partner from the directory. Existing jobs are kept." confirmLabel="Suspend" />}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
            {!rows.length && <tr><Td colSpan={7} className="py-10 text-center text-muted">No partners yet.</Td></tr>}
          </tbody>
        </Table>

        <Panel title={editing ? `Edit ${editing.name}` : "Add a partner"}>
          <ActionForm key={editing?.id ?? "new"} action={saveServicePartner} submitLabel={editing ? "Save changes" : "Add partner"} readOnly={!canAct}>
            {editing && <input type="hidden" name="partnerId" value={editing.id} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kind" htmlFor="sp-kind">
                <Select id="sp-kind" name="kind" defaultValue={editing?.kind ?? "garage"} className="h-10 text-sm">
                  {SERVICE_PARTNER_KINDS.map((k) => <option key={k} value={k}>{SERVICE_PARTNER_KIND_LABELS[k]}</option>)}
                </Select>
              </Field>
              <Field label="Name" htmlFor="sp-name"><Input id="sp-name" name="name" required defaultValue={editing?.name ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Phone" htmlFor="sp-phone"><Input id="sp-phone" name="phone" defaultValue={editing?.phone ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Email" htmlFor="sp-email"><Input id="sp-email" name="email" type="email" defaultValue={editing?.email ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Region" htmlFor="sp-region"><Input id="sp-region" name="region" defaultValue={editing?.region ?? ""} placeholder="Greater Accra" className="h-10 text-sm" /></Field>
              <Field label="Address" htmlFor="sp-address"><Input id="sp-address" name="address" defaultValue={editing?.address ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Latitude" htmlFor="sp-lat"><Input id="sp-lat" name="lat" defaultValue={gpsValue(editing?.gps, "lat")} className="h-10 text-sm" /></Field>
              <Field label="Longitude" htmlFor="sp-lng"><Input id="sp-lng" name="lng" defaultValue={gpsValue(editing?.gps, "lng")} className="h-10 text-sm" /></Field>
            </div>
            <Field label="Services" htmlFor="sp-services" hint="Comma-separated, e.g. panel beating, spraying, towing 24h">
              <Input id="sp-services" name="services" defaultValue={(editing?.services ?? []).join(", ")} className="h-10 text-sm" />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink-2">Direct billing with</legend>
              {insurers.length === 0 ? <p className="text-xs text-muted">No active insurers.</p> : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {insurers.map((i) => <Checkbox key={i.id} name="direct_billing_insurer_ids" value={i.id} defaultChecked={(editing?.direct_billing_insurer_ids ?? []).includes(i.id)} label={i.name} />)}
                </div>
              )}
            </fieldset>
            {editing && (
              <Field label="Status" htmlFor="sp-status">
                <Select id="sp-status" name="status" defaultValue={editing.status} className="h-10 text-sm">
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="suspended">Suspended</option>
                </Select>
              </Field>
            )}
            <Field label="Internal notes" htmlFor="sp-notes"><Textarea id="sp-notes" name="notes" rows={2} defaultValue={editing?.notes ?? ""} className="min-h-16 text-sm" /></Field>
            {editing && <p className="text-xs text-muted"><a href="/service-partners" className="text-brand hover:underline">Cancel editing</a></p>}
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}

function gpsValue(gps: unknown, key: "lat" | "lng"): string {
  if (gps && typeof gps === "object" && key in gps) {
    const v = (gps as Record<string, unknown>)[key];
    return typeof v === "number" ? String(v) : "";
  }
  return "";
}
