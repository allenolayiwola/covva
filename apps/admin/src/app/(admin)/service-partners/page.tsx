import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight, Info, Plus, Wrench } from "lucide-react";
import { Checkbox, EmptyState, Field, Input, Select, Textarea, buttonClass } from "@im/ui";
import type { Row } from "@im/db";
import { SERVICE_PARTNER_KIND_LABELS, SERVICE_PARTNER_KINDS, type ServicePartnerKind } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, isUuid, orgMap, sp, withParams, type OrgLite, type SearchParams } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, KeyValues, LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { Chip, Initials, PageHeader, StatRow, StatusPill, Table, THead, Th, Td, type Stat, type StatusTone } from "@/components/ui/page";
import { Drawer, DrawerTabs } from "@/components/ui/drawer";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { saveServicePartner, setServicePartnerStatus } from "./actions";

const BASE = "/service-partners";

type Partner = Row<"service_partners">;

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Awaiting review", tone: "wait" },
  approved: { label: "Approved", tone: "ok" },
  suspended: { label: "Suspended", tone: "off" },
};

const KIND_PLURAL: Record<ServicePartnerKind, string> = {
  garage: "Garages",
  towing: "Towing",
  hospital: "Hospitals",
  clinic: "Clinics",
  pharmacy: "Pharmacies",
  assessor: "Assessors",
};

/** Params that belong to the list (filters); the drawer params (new, id, tab) are layered on top. */
const FILTER_KEYS = ["q", "kind", "status", "region", "billing"] as const;

function listParams(params: SearchParams): SearchParams {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, sp(params, k)]).filter(([, v]) => v));
}

export default function ServicePartnersPage({ searchParams }: PageProps<"/service-partners">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Service partners" description="Post-claim network: garages, towing, hospitals, clinics, pharmacies and assessors." />
          <LoadingBlock label="Loading partners…" />
        </>
      }
    >
      <Directory searchParams={searchParams} />
    </Suspense>
  );
}

async function Directory({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const canAct = can(staff.roles, "network");

  const kind = sp(params, "kind");
  const status = sp(params, "status");
  const region = sp(params, "region");
  const q = sp(params, "q");
  const billing = sp(params, "billing") === "1";
  const isNew = sp(params, "new") === "1";
  // `?edit=<id>` is the previous URL shape (still linked from partner applications): open the drawer on its Edit tab.
  const legacyEdit = sp(params, "edit");
  const selectedId = sp(params, "id") ?? legacyEdit;
  const tab = legacyEdit && !sp(params, "id") ? "edit" : sp(params, "tab") === "edit" ? "edit" : "details";

  let query = supabase.from("service_partners").select("*").order("status").order("region").order("name").limit(300);
  if (kind) query = query.eq("kind", kind);
  if (status) query = query.eq("status", status);
  if (region) query = query.ilike("region", ilikeTerm(region));
  if (q) query = query.ilike("name", ilikeTerm(q));

  const [orgs, list, summary] = await Promise.all([
    orgMap(supabase),
    query,
    supabase.from("service_partners").select("status, kind, direct_billing_insurer_ids").limit(5000),
  ]);
  const insurers = [...orgs.values()].filter((o) => o.type === "insurer" && o.status !== "offboarded").sort((a, b) => a.name.localeCompare(b.name));
  const rows = (list.data ?? []).filter((r) => !billing || (r.direct_billing_insurer_ids ?? []).length > 0);
  const all = summary.data ?? [];

  let selected: Partner | undefined;
  if (isUuid(selectedId)) {
    selected = rows.find((r) => r.id === selectedId);
    if (!selected) {
      const { data } = await supabase.from("service_partners").select("*").eq("id", selectedId).maybeSingle();
      selected = data ?? undefined;
    }
  }

  const filters = listParams(params);
  const hasFilters = Object.keys(filters).length > 0;
  const closeHref = withParams(BASE, filters, {});
  const addHref = withParams(BASE, filters, { new: "1" });
  const filterHref = (overrides: Record<string, string | undefined>) => withParams(BASE, {}, overrides);

  const count = (pred: (r: (typeof all)[number]) => boolean) => all.filter(pred).length;
  const stats: (Stat | "divider")[] = [
    { label: "Approved", value: count((r) => r.status === "approved"), href: filterHref({ status: "approved" }), current: status === "approved" && !kind && !billing },
    { label: "Awaiting review", value: count((r) => r.status === "pending"), href: filterHref({ status: "pending" }), current: status === "pending" && !kind && !billing, tone: "wait" },
    { label: "Suspended", value: count((r) => r.status === "suspended"), href: filterHref({ status: "suspended" }), current: status === "suspended" && !kind && !billing },
    { label: "Direct billing", value: count((r) => (r.direct_billing_insurer_ids ?? []).length > 0), href: filterHref({ billing: "1" }), current: billing && !kind && !status },
    "divider",
    ...SERVICE_PARTNER_KINDS.map((k) => ({ label: KIND_PLURAL[k], value: count((r) => r.kind === k), href: filterHref({ kind: k }), current: kind === k && !status && !billing })),
  ];

  return (
    <>
      <PageHeader
        title="Service partners"
        description="Post-claim network: garages, towing, hospitals, clinics, pharmacies and assessors. Approved partners appear on the public directory and can be assigned to claims."
        actions={
          <Link id="add-partner" href={addHref} scroll={false} className={buttonClass("primary", "sm", "h-9 px-3.5")}>
            <Plus className="size-4" aria-hidden /> Add partner
          </Link>
        }
      />

      {summary.error ? null : <StatRow label="Partner counts" items={stats} />}

      <details className="group mb-4 max-w-[90ch] text-sm">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm py-0.5 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
          <Info className="size-4 text-brand" aria-hidden />
          How direct billing works
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <p className="mt-1.5 border-l-2 border-line pl-3 leading-relaxed text-ink-2">
          Tick the insurers a partner has a direct-billing agreement with. Customers then see &ldquo;Direct billing — you don&apos;t pay upfront&rdquo; for that
          partner on their claim, and the insurer settles the partner&apos;s invoice. Ratings and job history come later.
        </p>
      </details>

      <FilterBar
        action={BASE}
        trailing={<span className="tabular-nums">{rows.length === 1 ? "1 partner" : `${rows.length.toLocaleString("en-GB")} partners`}</span>}
      >
        <FilterInput name="q" label="Name" value={q} placeholder="Garage name" />
        <FilterSelect name="kind" label="Kind" value={kind} options={SERVICE_PARTNER_KINDS.map((k) => ({ value: k, label: SERVICE_PARTNER_KIND_LABELS[k] }))} />
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "pending", label: "Awaiting review" }, { value: "approved", label: "Approved" }, { value: "suspended", label: "Suspended" }]} />
        <FilterInput name="region" label="Region" value={region} placeholder="Greater Accra" />
        <FilterCheck name="billing" label="Direct billing" checked={billing} />
      </FilterBar>

      <ReadOnlyBanner show={!canAct} />
      {list.error && <p className="mb-3 text-sm text-danger">{list.error.message}</p>}

      {rows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Wrench className="size-5" />}
            title="No partners match these filters"
            body="Try a different name or region, or clear the filters to see the whole network."
            action={<Link href={BASE} className={buttonClass("outline", "sm", "h-9")}>Clear filters</Link>}
          />
        ) : (
          <EmptyState
            icon={<Wrench className="size-5" />}
            title="No service partners yet"
            body="Add the garages, towing firms, hospitals, clinics, pharmacies and assessors customers can use after a claim. New partners stay pending until you approve them."
            action={
              <Link href={addHref} scroll={false} className={buttonClass("primary", "sm", "h-9")}>
                <Plus className="size-4" aria-hidden /> Add the first partner
              </Link>
            }
          />
        )
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Partner</Th>
              <Th>Kind</Th>
              <Th>Region</Th>
              <Th>Direct billing</Th>
              <Th>Status</Th>
              <Th>Added</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((p) => {
              const st = STATUS[p.status] ?? { label: p.status, tone: "off" as const };
              const billingNames = insurerNames(p.direct_billing_insurer_ids, orgs);
              const isSelected = p.id === selected?.id;
              return (
                <tr key={p.id} className={isSelected ? "relative bg-head" : "relative hover:bg-head/70"}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Initials name={p.name} />
                      <div className="min-w-0">
                        {/* The name link covers the whole row (after:inset-0), so a click anywhere opens the drawer. */}
                        <Link
                          id={`partner-${p.id}`}
                          href={withParams(BASE, filters, { id: p.id })}
                          scroll={false}
                          prefetch={false}
                          aria-current={isSelected ? "true" : undefined}
                          className="font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand"
                        >
                          {p.name}
                        </Link>
                        {(p.address || p.phone) && <p className="truncate text-xs text-muted">{[p.address, p.phone].filter(Boolean).join(" · ")}</p>}
                      </div>
                    </div>
                  </Td>
                  <Td>{SERVICE_PARTNER_KIND_LABELS[p.kind as ServicePartnerKind] ?? p.kind}</Td>
                  <Td>{p.region ?? <span className="text-subtle">—</span>}</Td>
                  <Td>
                    {billingNames.length ? (
                      <span className="flex flex-wrap gap-1">
                        {billingNames.map((n) => <Chip key={n}>{n}</Chip>)}
                      </span>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </Td>
                  <Td><StatusPill tone={st.tone}>{st.label}</StatusPill></Td>
                  <Td className="whitespace-nowrap text-muted">{formatDate(p.created_at)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {rows.length >= 300 && <p className="mt-3 text-xs text-muted">Showing the first 300 partners. Narrow the filters to find others.</p>}

      {isNew && (
        <Drawer title="Add a partner" description="New partners stay pending until approved." closeHref={closeHref} returnFocusId="add-partner">
          <PartnerForm insurers={insurers} canAct={canAct} />
        </Drawer>
      )}

      {!isNew && selected && (
        <Drawer
          eyebrow={SERVICE_PARTNER_KIND_LABELS[selected.kind as ServicePartnerKind] ?? selected.kind}
          title={selected.name}
          closeHref={closeHref}
          returnFocusId={`partner-${selected.id}`}
          meta={
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={(STATUS[selected.status] ?? STATUS.suspended!).tone}>{STATUS[selected.status]?.label ?? selected.status}</StatusPill>
                {selected.review_count > 0 && (
                  <span className="text-xs text-muted">
                    {selected.rating != null ? `${selected.rating.toFixed(1)} ★ · ` : ""}
                    {selected.review_count} review{selected.review_count === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <DrawerTabs
                active={tab}
                items={[
                  { key: "details", label: "Details", href: withParams(BASE, filters, { id: selected.id }) },
                  { key: "edit", label: "Edit", href: withParams(BASE, filters, { id: selected.id, tab: "edit" }) },
                ]}
              />
            </div>
          }
        >
          {tab === "edit" ? (
            <PartnerForm editing={selected} insurers={insurers} canAct={canAct} />
          ) : (
            <PartnerDetails partner={selected} orgs={orgs} canAct={canAct} editHref={withParams(BASE, filters, { id: selected.id, tab: "edit" })} />
          )}
        </Drawer>
      )}
    </>
  );
}

function insurerNames(ids: string[] | null, orgs: Map<string, OrgLite>): string[] {
  return (ids ?? []).map((id) => orgs.get(id)?.name).filter((n): n is string => !!n);
}

function PartnerDetails({ partner: p, orgs, canAct, editHref }: { partner: Partner; orgs: Map<string, OrgLite>; canAct: boolean; editHref: string }) {
  const billingNames = insurerNames(p.direct_billing_insurer_ids, orgs);
  const lat = gpsValue(p.gps, "lat");
  const lng = gpsValue(p.gps, "lng");
  return (
    <div className="space-y-6">
      <KeyValues
        items={[
          { label: "Region", value: p.region },
          { label: "Phone", value: p.phone ? <a href={`tel:${p.phone.replace(/\s+/g, "")}`} className="hover:text-brand">{p.phone}</a> : null },
          { label: "Email", value: p.email ? <a href={`mailto:${p.email}`} className="break-all hover:text-brand">{p.email}</a> : null },
          { label: "Address", value: p.address },
          { label: "Location", value: lat && lng ? `${lat}, ${lng}` : null },
          { label: "Added", value: formatDateTime(p.created_at) },
        ]}
      />

      <section aria-labelledby="sp-services-h">
        <h3 id="sp-services-h" className="mb-1.5 text-xs font-semibold text-muted">Services</h3>
        {p.services?.length ? (
          <div className="flex flex-wrap gap-1.5">{p.services.map((s) => <Chip key={s}>{s}</Chip>)}</div>
        ) : (
          <p className="text-sm text-subtle">None listed.</p>
        )}
      </section>

      <section aria-labelledby="sp-billing-h" className="rounded-sm border border-line p-3.5">
        <h3 id="sp-billing-h" className="text-sm font-semibold text-ink">Direct billing</h3>
        <p className="mt-1 text-sm text-muted">
          {billingNames.length
            ? `${billingNames.join(", ")}. Customers of ${billingNames.length === 1 ? "this insurer" : "these insurers"} pay nothing upfront; the insurer settles the partner's invoice.`
            : "No direct-billing agreements recorded. Customers pay the partner and claim the cost back."}
        </p>
      </section>

      <section aria-labelledby="sp-notes-h">
        <h3 id="sp-notes-h" className="mb-1.5 text-xs font-semibold text-muted">Internal notes</h3>
        {p.notes ? <p className="whitespace-pre-wrap text-sm text-ink-2">{p.notes}</p> : <p className="text-sm text-subtle">No notes.</p>}
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Link href={editHref} scroll={false} replace className={buttonClass("outline", "sm", "h-9")}>
          Edit partner
        </Link>
        {canAct && p.status !== "approved" && (
          <ConfirmAction
            action={setServicePartnerStatus}
            fields={{ partnerId: p.id, status: "approved" }}
            label="Approve"
            title={`Approve ${p.name}`}
            body="Publishes the partner on the public directory and makes it assignable to claims."
            confirmLabel="Approve"
            variant="primary"
            triggerVariant="secondary"
            requireReason={false}
          />
        )}
        {canAct && p.status !== "suspended" && (
          <ConfirmAction
            action={setServicePartnerStatus}
            fields={{ partnerId: p.id, status: "suspended" }}
            label="Suspend"
            title={`Suspend ${p.name}`}
            body="Removes the partner from the directory. Existing jobs are kept."
            confirmLabel="Suspend"
          />
        )}
      </div>
    </div>
  );
}

/** The add / edit form (same fields, names and server action as before; only its container changed). */
function PartnerForm({ editing, insurers, canAct }: { editing?: Partner; insurers: OrgLite[]; canAct: boolean }) {
  return (
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
        <Field label="Latitude" htmlFor="sp-lat"><Input id="sp-lat" name="lat" inputMode="decimal" defaultValue={gpsValue(editing?.gps, "lat")} className="h-10 text-sm" /></Field>
        <Field label="Longitude" htmlFor="sp-lng"><Input id="sp-lng" name="lng" inputMode="decimal" defaultValue={gpsValue(editing?.gps, "lng")} className="h-10 text-sm" /></Field>
      </div>
      <Field label="Services" htmlFor="sp-services" hint="Comma-separated, e.g. panel beating, spraying, towing 24h">
        <Input id="sp-services" name="services" defaultValue={(editing?.services ?? []).join(", ")} className="h-10 text-sm" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-2">Direct billing with</legend>
        {insurers.length === 0 ? <p className="text-xs text-muted">No active insurers.</p> : (
          <div className="grid gap-1.5 sm:grid-cols-2">
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
      <Field label="Internal notes" htmlFor="sp-notes"><Textarea id="sp-notes" name="notes" rows={3} defaultValue={editing?.notes ?? ""} className="min-h-20 text-sm" /></Field>
    </ActionForm>
  );
}

function gpsValue(gps: unknown, key: "lat" | "lng"): string {
  if (gps && typeof gps === "object" && key in gps) {
    const v = (gps as Record<string, unknown>)[key];
    return typeof v === "number" ? String(v) : "";
  }
  return "";
}
