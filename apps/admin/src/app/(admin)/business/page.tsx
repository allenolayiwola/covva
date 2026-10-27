import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { INVOICE_STATUS, SCHEME_STATUS, type BusinessProfile, type SchemeStatus } from "@im/core";
import { Notice, PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, orgMap, pageOf, sp, type SearchParams, type Supabase } from "@/lib/query";
import { formatDate, formatGHS } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock, Pagination } from "@/components/ui/layout";

/**
 * SME & group oversight (Roadmap Phase 3): business accounts, group schemes (census sizes), fleet sizes and
 * consolidated statements. Read-only — schemes are placed by brokers and every statement line is paid to its insurer.
 */
export default function BusinessPage({ searchParams }: PageProps<"/business">) {
  return (
    <>
      <PageHeader title="Business accounts" description="SME & group: business accounts, schemes, fleets and consolidated statements." />
      <Notice tone="info" icon={<Building2 className="size-4" />} title="Broker-routed, paid per insurer" className="mb-5">
        Group schemes, fleets and commercial risks always go to a licensed broker. A consolidated statement is a view: each insurer line is paid separately and settles to that insurer.
      </Notice>
      <Suspense fallback={<LoadingBlock label="Loading business accounts…" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const view = sp(params, "view") ?? "accounts";
  const { page, from, to } = pageOf(params);
  const [{ count: accounts }, { count: schemes }, { count: lives }, { count: vehicles }, { count: due }] = await Promise.all([
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("type", "enterprise"),
    supabase.from("group_schemes").select("id", { count: "exact", head: true }).neq("status", "cancelled"),
    supabase.from("scheme_members").select("id", { count: "exact", head: true }).neq("status", "removed"),
    supabase.from("fleet_vehicles").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("business_invoices").select("id", { count: "exact", head: true }).in("status", ["issued", "overdue"]),
  ]);
  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Business accounts" value={String(accounts ?? 0)} />
        <Kpi label="Live schemes" value={String(schemes ?? 0)} />
        <Kpi label="Covered lives" value={String(lives ?? 0)} />
        <Kpi label="Fleet vehicles" value={String(vehicles ?? 0)} />
        <Kpi label="Statements due" value={String(due ?? 0)} />
      </div>
      <FilterBar action="/business">
        <FilterSelect name="view" label="View" value={view} options={[{ value: "accounts", label: "Business accounts" }, { value: "schemes", label: "Group schemes" }, { value: "invoices", label: "Statements" }]} />
      </FilterBar>
      {view === "accounts" && <Accounts supabase={supabase} params={params} page={page} from={from} to={to} />}
      {view === "schemes" && <Schemes supabase={supabase} params={params} page={page} from={from} to={to} />}
      {view === "invoices" && <Invoices supabase={supabase} params={params} page={page} from={from} to={to} />}
    </>
  );
}

type ListProps = { supabase: Supabase; params: SearchParams; page: number; from: number; to: number };

async function Accounts({ supabase, params, page, from, to }: ListProps) {
  const { data, count } = await supabase.from("organizations").select("id, name, status, contact_email, region, business_profile, created_at", { count: "exact" }).eq("type", "enterprise").order("created_at", { ascending: false }).range(from, to);
  const ids = (data ?? []).map((o) => o.id);
  const [{ data: members }, { data: schemes }, { data: fleet }] = await Promise.all([
    ids.length ? supabase.from("memberships").select("org_id").in("org_id", ids).eq("active", true) : Promise.resolve({ data: [] as { org_id: string }[] }),
    ids.length ? supabase.from("group_schemes").select("business_org_id, member_count, status").in("business_org_id", ids) : Promise.resolve({ data: [] as { business_org_id: string; member_count: number; status: string }[] }),
    ids.length ? supabase.from("fleet_vehicles").select("business_org_id").in("business_org_id", ids).eq("status", "active") : Promise.resolve({ data: [] as { business_org_id: string }[] }),
  ]);
  const n = <T,>(xs: T[] | null, f: (x: T) => boolean) => (xs ?? []).filter(f).length;
  return (
    <>
      <Table>
        <THead><tr><Th>Business</Th><Th>Industry</Th><Th>Employees</Th><Th>Users</Th><Th>Schemes</Th><Th>Lives</Th><Th>Fleet</Th><Th>Billing</Th><Th>Created</Th></tr></THead>
        <tbody>
          {(data ?? []).map((o) => {
            const p = (o.business_profile ?? {}) as BusinessProfile;
            const mine = (schemes ?? []).filter((s) => s.business_org_id === o.id && s.status !== "cancelled");
            return (
              <tr key={o.id}>
                <Td className="font-medium text-ink">{o.name}<span className="block text-xs text-muted">{o.region ?? ""}{o.status !== "active" ? ` · ${o.status}` : ""}</span></Td>
                <Td>{p.industry ?? "—"}</Td>
                <Td>{p.employees ?? "—"}</Td>
                <Td>{n(members, (m) => m.org_id === o.id)}</Td>
                <Td>{mine.length}</Td>
                <Td>{mine.reduce((s, x) => s + x.member_count, 0)}</Td>
                <Td>{n(fleet, (v) => v.business_org_id === o.id)}</Td>
                <Td className="text-xs">{p.billing_email ?? o.contact_email ?? "—"}</Td>
                <Td>{formatDate(o.created_at)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination base="/business" params={params} page={page} total={count} />
    </>
  );
}

async function Schemes({ supabase, params, page, from, to }: ListProps) {
  const [{ data, count }, orgs, cats] = await Promise.all([
    supabase.from("group_schemes").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to),
    orgMap(supabase),
    categoryMap(supabase),
  ]);
  return (
    <>
      <Table>
        <THead><tr><Th>Scheme</Th><Th>Business</Th><Th>Cover</Th><Th>Lives</Th><Th>Broker</Th><Th>Insurer</Th><Th>Renewal</Th><Th>Status</Th></tr></THead>
        <tbody>
          {(data ?? []).map((s) => {
            const meta = SCHEME_STATUS[s.status as SchemeStatus] ?? SCHEME_STATUS.draft;
            return (
              <tr key={s.id}>
                <Td className="font-medium text-ink">{s.name}<span className="block text-xs text-muted">{s.reference}</span></Td>
                <Td>{orgs.get(s.business_org_id)?.name ?? "—"}</Td>
                <Td>{cats.get(s.category_id)?.name ?? "—"}</Td>
                <Td>{s.member_count}</Td>
                <Td>{s.broker_org_id ? orgs.get(s.broker_org_id)?.name ?? "—" : <Pill tone="wait">Not yet</Pill>}</Td>
                <Td>{s.insurer_org_id ? orgs.get(s.insurer_org_id)?.name ?? "—" : "—"}</Td>
                <Td>{formatDate(s.renewal_date)}</Td>
                <Td><Pill tone={meta.tone}>{meta.label}</Pill></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination base="/business" params={params} page={page} total={count} />
    </>
  );
}

async function Invoices({ supabase, params, page, from, to }: ListProps) {
  const [{ data, count }, orgs] = await Promise.all([
    supabase.from("business_invoices").select("*", { count: "exact" }).order("period_start", { ascending: false }).range(from, to),
    orgMap(supabase),
  ]);
  return (
    <>
      <Table>
        <THead><tr><Th>Statement</Th><Th>Business</Th><Th>Period</Th><Th>Insurers</Th><Th>Total</Th><Th>Due</Th><Th>Status</Th></tr></THead>
        <tbody>
          {(data ?? []).map((i) => {
            const lines = Array.isArray(i.lines) ? (i.lines as { insurer_org_id?: string }[]) : [];
            const meta = INVOICE_STATUS[i.status as keyof typeof INVOICE_STATUS] ?? INVOICE_STATUS.issued;
            return (
              <tr key={i.id}>
                <Td className="font-medium text-ink">{i.reference}</Td>
                <Td>{orgs.get(i.business_org_id)?.name ?? "—"}</Td>
                <Td>{formatDate(i.period_start)} – {formatDate(i.period_end)}</Td>
                <Td>{new Set(lines.map((l) => l.insurer_org_id)).size} ({lines.length} lines)</Td>
                <Td>{formatGHS(Number(i.total), { decimals: true })}</Td>
                <Td>{formatDate(i.due_at)}</Td>
                <Td><Pill tone={meta.tone}>{meta.label}</Pill></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination base="/business" params={params} page={page} total={count} />
    </>
  );
}
