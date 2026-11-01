import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { Checkbox, EmptyState, Field, Notice, Select, buttonClass } from "@im/ui";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, isUuid, pageOf, sp, withParams, type SearchParams } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { ORG_STATUSES, ORG_TYPES, STATUS_TONE } from "@/lib/org-meta";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, KeyValues, LoadingBlock, Pagination } from "@/components/ui/layout";
import { Chip, Initials, PageHeader, RowLink, StatRow, StatusPill, Table, THead, Th, Td, type Stat, type StatusTone } from "@/components/ui/page";
import { Drawer } from "@/components/ui/drawer";
import { ActionForm } from "@/components/ui/forms";
import { OrgFields } from "./OrgForm";
import { createOrganisation } from "./actions";

const BASE = "/organisations";
const FILTER_KEYS = ["q", "type", "status", "expiring", "unverified"] as const;
const DESCRIPTION = "Brokers, insurers and enterprise clients. Partners go live only after licence verification and due diligence.";
/** Licensed partner types: the only ones with an NIC licence to verify and track. */
const LICENSED: Enum<"org_type">[] = ["broker", "insurer"];
const EXPIRY_WARNING_DAYS = 60;

const TYPE_LABEL: Record<Enum<"org_type">, string> = {
  broker: "Broker",
  insurer: "Insurer",
  enterprise: "Enterprise",
  distributor: "Distributor",
  platform: "Platform",
};
const STATUS_LABEL: Record<Enum<"org_status">, string> = {
  active: "Active",
  pending: "Pending",
  suspended: "Suspended",
  offboarded: "Offboarded",
};

export default function OrganisationsPage({ searchParams }: PageProps<"/organisations">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Organisations" description={DESCRIPTION} />
          <LoadingBlock label="Loading organisations…" />
        </>
      }
    >
      <OrgList searchParams={searchParams} />
    </Suspense>
  );
}

/** Licences expiring before this date (YYYY-MM-DD) are flagged. */
function licenceWarnBy(now = Date.now()): string {
  return new Date(now + EXPIRY_WARNING_DAYS * 86_400_000).toISOString().slice(0, 10);
}

function statusTone(status: Enum<"org_status">): StatusTone {
  const t = STATUS_TONE[status];
  return t === "neutral" ? "off" : t;
}

function expiryTone(date: string | null): StatusTone {
  if (!date) return "off";
  const days = (new Date(date).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? "danger" : days < EXPIRY_WARNING_DAYS ? "wait" : "ok";
}

function Expiry({ date, missing = "—" }: { date: string | null; missing?: React.ReactNode }) {
  if (!date) return <span className="text-subtle">{missing}</span>;
  return <StatusPill tone={expiryTone(date)}>{formatDate(date)}</StatusPill>;
}

async function OrgList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const canAct = can(staff.roles, "network");
  const { page, from, to } = pageOf(params);
  const type = sp(params, "type");
  const status = sp(params, "status");
  const q = sp(params, "q");
  const expiring = sp(params, "expiring") === "1";
  const unverified = sp(params, "unverified") === "1";
  const isNew = sp(params, "new") === "1";
  const selectedId = sp(params, "id");
  const warnBy = licenceWarnBy();

  let query = supabase
    .from("organizations")
    .select("id, name, type, status, slug, nic_licence_number, nic_licence_class, nic_licence_expires_on, licence_verified_at, professional_indemnity_expires_on, integration_level, settings, region, created_at", { count: "exact" })
    .order("type")
    .order("name")
    .range(from, to);
  if (type && (ORG_TYPES as string[]).includes(type)) query = query.eq("type", type as Enum<"org_type">);
  if (status && (ORG_STATUSES as string[]).includes(status)) query = query.eq("status", status as Enum<"org_status">);
  if (q) query = query.or(`name.ilike.${ilikeTerm(q)},legal_name.ilike.${ilikeTerm(q)},nic_licence_number.ilike.${ilikeTerm(q)}`);
  if (expiring) query = query.in("type", LICENSED).neq("status", "offboarded").lt("nic_licence_expires_on", warnBy);
  if (unverified) query = query.in("type", LICENSED).neq("status", "offboarded").is("licence_verified_at", null);

  const head = () => supabase.from("organizations").select("id", { count: "exact", head: true });
  const [list, cActive, cPending, cSuspended, cBrokers, cInsurers, cEnterprise, cExpiring, cUnverified] = await Promise.all([
    query,
    head().eq("status", "active"),
    head().eq("status", "pending"),
    head().eq("status", "suspended"),
    head().eq("type", "broker").neq("status", "offboarded"),
    head().eq("type", "insurer").neq("status", "offboarded"),
    head().eq("type", "enterprise").neq("status", "offboarded"),
    head().in("type", LICENSED).neq("status", "offboarded").lt("nic_licence_expires_on", warnBy),
    head().in("type", LICENSED).neq("status", "offboarded").is("licence_verified_at", null),
  ]);
  const rows = list.data ?? [];

  const filters: SearchParams = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp(params, k)]).filter(([, v]) => v));
  const hasFilters = Object.keys(filters).length > 0;
  const pageParam = page > 1 ? String(page) : undefined;
  const closeHref = withParams(BASE, filters, { page: pageParam });
  const addHref = withParams(BASE, filters, { page: pageParam, new: "1" });
  const only = (key: string, value: string) => Object.keys(filters).length === 1 && filters[key] === value;
  const stat = (label: string, value: number | null, key: string, v: string, tone?: Stat["tone"]): Stat => ({
    label,
    value: value ?? "—",
    href: withParams(BASE, {}, { [key]: v }),
    current: only(key, v),
    tone,
  });
  const stats: (Stat | "divider")[] = [
    stat("Active", cActive.count, "status", "active"),
    stat("Pending", cPending.count, "status", "pending", "wait"),
    stat("Suspended", cSuspended.count, "status", "suspended"),
    "divider",
    stat("Brokers", cBrokers.count, "type", "broker"),
    stat("Insurers", cInsurers.count, "type", "insurer"),
    stat("Enterprise", cEnterprise.count, "type", "enterprise"),
    "divider",
    stat(`Licence expiring (${EXPIRY_WARNING_DAYS} days)`, cExpiring.count, "expiring", "1", "danger"),
    stat("Licence not verified", cUnverified.count, "unverified", "1", "wait"),
  ];

  return (
    <>
      <PageHeader
        title="Organisations"
        description={DESCRIPTION}
        actions={
          canAct ? (
            <Link id="add-organisation" href={addHref} scroll={false} className={buttonClass("primary", "sm", "h-9 px-3.5")}>
              <Plus className="size-4" aria-hidden /> New organisation
            </Link>
          ) : null
        }
      />
      <StatRow label="Organisation counts" items={stats} />

      <FilterBar
        action={BASE}
        trailing={list.count != null && <span className="tabular-nums">{list.count === 1 ? "1 organisation" : `${list.count.toLocaleString("en-GB")} organisations`}</span>}
      >
        <FilterInput name="q" label="Name or licence" value={q} />
        <FilterSelect name="type" label="Type" value={type} options={ORG_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        <FilterSelect name="status" label="Status" value={status} options={ORG_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <FilterCheck name="expiring" label="Licence expiring" checked={expiring} />
        <FilterCheck name="unverified" label="Not verified" checked={unverified} />
      </FilterBar>
      {list.error && <p className="mb-3 text-sm text-danger">{list.error.message}</p>}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title={hasFilters ? "No organisations match these filters" : "No organisations yet"}
          body={hasFilters ? "Try a different name, type or status, or clear the filters." : "Add the brokers, insurers and enterprise clients that work through Covva."}
          action={hasFilters ? <Link href={BASE} className={buttonClass("outline", "sm", "h-9")}>Clear filters</Link> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Organisation</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>NIC licence</Th>
              <Th>Licence expiry</Th>
              <Th>PI expiry</Th>
              <Th>Integration</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((o) => {
              const demo = (o.settings as { demo?: boolean } | null)?.demo;
              const isSelected = o.id === selectedId;
              const licensed = LICENSED.includes(o.type);
              return (
                <tr key={o.id} className={isSelected ? "relative bg-head" : "relative hover:bg-head/70"}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Initials name={o.name} />
                      <div className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <RowLink id={`org-${o.id}`} href={withParams(BASE, filters, { page: pageParam, id: o.id })} current={isSelected}>{o.name}</RowLink>
                          {demo && <Chip>Demo</Chip>}
                        </span>
                        <p className="truncate text-xs text-muted">{o.region ?? "—"}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>{TYPE_LABEL[o.type] ?? o.type}</Td>
                  <Td><StatusPill tone={statusTone(o.status)}>{STATUS_LABEL[o.status] ?? o.status}</StatusPill></Td>
                  <Td>
                    {o.nic_licence_number ? <span className="font-mono text-xs">{o.nic_licence_number}</span> : <span className="text-subtle">—</span>}
                    {licensed && (
                      <p className="mt-0.5">{o.licence_verified_at ? <StatusPill tone="ok">Verified</StatusPill> : <StatusPill tone="wait">Not verified</StatusPill>}</p>
                    )}
                  </Td>
                  <Td><Expiry date={o.nic_licence_expires_on} /></Td>
                  <Td>{o.type === "broker" ? <Expiry date={o.professional_indemnity_expires_on} missing={<StatusPill tone="wait">Missing</StatusPill>} /> : <span className="text-subtle">—</span>}</Td>
                  <Td className="capitalize">{o.integration_level?.replace("_", " ") ?? <span className="text-subtle">—</span>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination base={BASE} params={filters} page={page} total={list.count} />

      {isNew && (
        <Drawer
          title="New organisation"
          description="New partners start as pending. Verify the NIC licence and complete due diligence before activating."
          closeHref={closeHref}
          returnFocusId="add-organisation"
          className="max-w-[720px]"
        >
          <NewOrgForm canAct={canAct} />
        </Drawer>
      )}

      {!isNew && isUuid(selectedId) && (
        <Suspense fallback={null}>
          <OrgDrawer id={selectedId} closeHref={closeHref} />
        </Suspense>
      )}
    </>
  );
}

/** Same fields and server action as /organisations/new (which still works as a full page). */
function NewOrgForm({ canAct }: { canAct: boolean }) {
  return (
    <ActionForm action={createOrganisation} submitLabel="Create organisation" readOnly={!canAct}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="type">
          <Select id="type" name="type" required defaultValue="broker">
            <option value="broker">Broker</option>
            <option value="insurer">Insurer</option>
            <option value="enterprise">Enterprise (employer / affinity)</option>
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox name="demo" label="Demo / fictional organisation (settings.demo)" />
        </div>
      </div>
      <OrgFields />
      <Notice tone="info">Fields that don&apos;t apply to the chosen type (e.g. Paystack subaccount for non-insurers) are ignored.</Notice>
    </ActionForm>
  );
}

async function OrgDrawer({ id, closeHref }: { id: string; closeHref: string }) {
  const supabase = await createClient();
  const { data: o } = await supabase.from("organizations").select("*").eq("id", id).maybeSingle();
  if (!o) return null;
  const { count: members } = await supabase.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", id).eq("active", true);
  const demo = (o.settings as { demo?: boolean } | null)?.demo;
  const licensed = LICENSED.includes(o.type);

  return (
    <Drawer
      eyebrow={TYPE_LABEL[o.type] ?? o.type}
      title={o.name}
      description={o.legal_name && o.legal_name !== o.name ? o.legal_name : undefined}
      closeHref={closeHref}
      returnFocusId={`org-${o.id}`}
      meta={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone(o.status)}>{STATUS_LABEL[o.status] ?? o.status}</StatusPill>
          {licensed && (o.licence_verified_at ? <StatusPill tone="ok">Licence verified</StatusPill> : <StatusPill tone="wait">Licence not verified</StatusPill>)}
          {demo && <Chip>Demo</Chip>}
        </div>
      }
    >
      <div className="space-y-6">
        <KeyValues
          items={[
            { label: "Region", value: o.region },
            { label: "Active members", value: members ?? 0 },
            ...(o.type !== "enterprise" && o.type !== "platform"
              ? [
                  { label: "NIC licence", value: o.nic_licence_number ? <span className="font-mono text-xs">{o.nic_licence_number}</span> : null },
                  { label: "Licence class", value: o.nic_licence_class },
                  { label: "Licence expires", value: <Expiry date={o.nic_licence_expires_on} /> },
                  { label: "Verified", value: o.licence_verified_at ? formatDateTime(o.licence_verified_at) : "Not yet" },
                ]
              : []),
            ...(o.type === "broker" ? [{ label: "PI cover expires", value: <Expiry date={o.professional_indemnity_expires_on} missing="Missing" /> }] : []),
            ...(o.type === "insurer" ? [{ label: "Integration", value: <span className="capitalize">{o.integration_level?.replace("_", " ") ?? "Not set"}</span> }] : []),
            { label: "Contact email", value: o.contact_email ? <a href={`mailto:${o.contact_email}`} className="break-all hover:text-brand">{o.contact_email}</a> : null },
            { label: "Contact phone", value: o.contact_phone ? <a href={`tel:${o.contact_phone.replace(/\s+/g, "")}`} className="hover:text-brand">{o.contact_phone}</a> : null },
            { label: "Added", value: formatDateTime(o.created_at) },
          ]}
        />

        {o.description && <p className="whitespace-pre-wrap text-sm text-ink-2">{o.description}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Link href={`/organisations/${o.id}`} className={buttonClass("primary", "sm", "h-9")}>
            Open full record <ArrowRight className="size-4" aria-hidden />
          </Link>
          <p className="text-xs text-muted">Members, routing, subscription, due diligence and edits are on the full record.</p>
        </div>
      </div>
    </Drawer>
  );
}
