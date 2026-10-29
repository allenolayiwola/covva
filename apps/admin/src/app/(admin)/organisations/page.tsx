import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Pill, buttonClass } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, pageOf, sp, type SearchParams } from "@/lib/query";
import { formatDate } from "@/lib/format";
import { ORG_STATUSES, ORG_TYPES, STATUS_TONE } from "@/lib/org-meta";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Pagination } from "@/components/ui/layout";

export default function OrganisationsPage({ searchParams }: PageProps<"/organisations">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading organisations…" />}>
      <OrgList searchParams={searchParams} />
    </Suspense>
  );
}

function expiryTone(date: string | null): "ok" | "wait" | "danger" | "neutral" {
  if (!date) return "neutral";
  const days = (new Date(date).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? "danger" : days < 60 ? "wait" : "ok";
}

async function OrgList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);
  const type = sp(params, "type");
  const status = sp(params, "status");
  const q = sp(params, "q");

  let query = supabase
    .from("organizations")
    .select("id, name, type, status, slug, nic_licence_number, nic_licence_class, nic_licence_expires_on, licence_verified_at, professional_indemnity_expires_on, integration_level, settings, region, created_at", { count: "exact" })
    .order("type")
    .order("name")
    .range(from, to);
  if (type && (ORG_TYPES as string[]).includes(type)) query = query.eq("type", type as Enum<"org_type">);
  if (status && (ORG_STATUSES as string[]).includes(status)) query = query.eq("status", status as Enum<"org_status">);
  if (q) query = query.or(`name.ilike.${ilikeTerm(q)},legal_name.ilike.${ilikeTerm(q)},nic_licence_number.ilike.${ilikeTerm(q)}`);
  const { data, count, error } = await query;

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Brokers, insurers and enterprise clients. Partners go live only after licence verification and due diligence."
        actions={can(staff.roles, "network") ? <Link href="/organisations/new" className={buttonClass("primary", "sm")}><Plus className="size-4" /> New organisation</Link> : null}
      />
      <FilterBar action="/organisations">
        <FilterInput name="q" label="Name or licence" value={q} />
        <FilterSelect name="type" label="Type" value={type} options={ORG_TYPES.map((t) => ({ value: t, label: t }))} />
        <FilterSelect name="status" label="Status" value={status} options={ORG_STATUSES.map((t) => ({ value: t, label: t }))} />
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Organisation</Th><Th>Type</Th><Th>Status</Th><Th>NIC licence</Th><Th>Licence expiry</Th><Th>PI expiry</Th><Th>Integration</Th></tr></THead>
        <tbody>
          {(data ?? []).map((o) => {
            const demo = (o.settings as { demo?: boolean } | null)?.demo;
            return (
              <tr key={o.id} className="hover:bg-mist/60">
                <Td>
                  <Link href={`/organisations/${o.id}`} className="font-semibold text-ink hover:text-brand">{o.name}</Link>
                  {demo && <Pill tone="neutral" className="ml-2">Demo</Pill>}
                  <p className="text-xs text-muted">{o.region ?? "—"}</p>
                </Td>
                <Td className="capitalize">{o.type}</Td>
                <Td><Pill tone={STATUS_TONE[o.status]}>{o.status}</Pill></Td>
                <Td>
                  {o.nic_licence_number ? <span className="font-mono text-xs">{o.nic_licence_number}</span> : <span className="text-muted">—</span>}
                  {o.type !== "platform" && o.type !== "enterprise" && (
                    <p className="mt-0.5">{o.licence_verified_at ? <Pill tone="ok">Verified</Pill> : <Pill tone="wait">Not verified</Pill>}</p>
                  )}
                </Td>
                <Td>{o.nic_licence_expires_on ? <Pill tone={expiryTone(o.nic_licence_expires_on)}>{formatDate(o.nic_licence_expires_on)}</Pill> : "—"}</Td>
                <Td>{o.type === "broker" ? (o.professional_indemnity_expires_on ? <Pill tone={expiryTone(o.professional_indemnity_expires_on)}>{formatDate(o.professional_indemnity_expires_on)}</Pill> : <Pill tone="wait">Missing</Pill>) : "—"}</Td>
                <Td>{o.integration_level?.replace("_", " ") ?? "—"}</Td>
              </tr>
            );
          })}
          {!data?.length && <tr><Td colSpan={7} className="py-10 text-center text-muted">No organisations match.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/organisations" params={params} page={page} total={count} />
    </>
  );
}
