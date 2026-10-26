import { Suspense } from "react";
import Link from "next/link";
import { Checkbox, Field, Input, PageHeader, Pill, Select, Table, THead, Th, Td } from "@im/ui";
import { GHANA_REGIONS } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, orgMap, sp, type SearchParams } from "@/lib/query";
import { FilterBar, FilterSelect, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ToggleForm } from "@/components/ui/forms";
import { saveRoutingRule, simulateRouting, toggleRoutingRule } from "./actions";
import { RoutingSimulator } from "./Simulator";

export default function RoutingPage({ searchParams }: PageProps<"/routing">) {
  return (
    <>
      <PageHeader
        title="Routing"
        description="Which broker of record receives each new request. Routing uses category, licence, insurer access, region, segment, capacity and service performance — never the highest payment to the platform."
      />
      <Suspense fallback={<LoadingBlock label="Loading routing rules…" />}>
        <Routing searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Routing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const [orgs, cats] = await Promise.all([orgMap(supabase), categoryMap(supabase)]);
  const category = sp(params, "category");
  const broker = sp(params, "broker");
  let query = supabase.from("broker_routing_rules").select("*").order("category_id").order("priority");
  if (category) query = query.eq("category_id", category);
  if (broker) query = query.eq("broker_org_id", broker);
  const { data: rules } = await query;
  const canAct = can(staff.roles, "network");
  const brokers = [...orgs.values()].filter((o) => o.type === "broker");
  const catList = [...cats.values()];

  return (
    <div className="space-y-6">
      <Panel title="Simulate routing" description="Runs routeRequest from @im/core against live data.">
        <RoutingSimulator action={simulateRouting} categories={catList} regions={GHANA_REGIONS} />
      </Panel>

      <div>
        <FilterBar action="/routing">
          <FilterSelect name="category" label="Category" value={category} options={catList.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect name="broker" label="Broker" value={broker} options={brokers.map((b) => ({ value: b.id, label: b.name }))} />
        </FilterBar>
        <ReadOnlyBanner show={!canAct} />
        <Table>
          <THead><tr><Th>Category</Th><Th>Broker</Th><Th>Priority</Th><Th>Role</Th><Th>Regions</Th><Th>Segments</Th><Th>Daily cap</Th><Th>Active</Th><Th /></tr></THead>
          <tbody>
            {(rules ?? []).map((r) => (
              <tr key={r.id} className="align-top">
                <Td>{cats.get(r.category_id)?.name}</Td>
                <Td>
                  <Link href={`/organisations/${r.broker_org_id}?tab=routing`} className="hover:text-brand">{orgs.get(r.broker_org_id)?.name}</Link>
                  {orgs.get(r.broker_org_id)?.status !== "active" && <Pill tone="danger" className="ml-1">{orgs.get(r.broker_org_id)?.status}</Pill>}
                </Td>
                <Td className="tabular-nums">{r.priority}</Td>
                <Td>{r.is_secondary ? <Pill tone="neutral">Secondary</Pill> : <Pill tone="ok">Primary</Pill>}</Td>
                <Td className="max-w-48 text-xs">{r.regions.length ? r.regions.join(", ") : "Nationwide"}</Td>
                <Td className="text-xs">{r.segments.length ? r.segments.join(", ") : "All"}</Td>
                <Td>{r.daily_capacity ?? "∞"}</Td>
                <Td><ToggleForm action={toggleRoutingRule} fields={{ ruleId: r.id }} checked={r.active} label="Rule active" disabled={!canAct} /></Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-sm text-brand">Edit</summary>
                    <div className="mt-3 w-[min(560px,80vw)]">
                      <RuleForm
                        canAct={canAct}
                        brokers={brokers}
                        categories={catList}
                        rule={{ brokerOrgId: r.broker_org_id, categoryId: r.category_id, priority: r.priority, is_secondary: r.is_secondary, regions: r.regions, segments: r.segments, daily_capacity: r.daily_capacity, active: r.active }}
                      />
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
            {!rules?.length && <tr><Td colSpan={9} className="py-8 text-center text-muted">No routing rules.</Td></tr>}
          </tbody>
        </Table>
      </div>

      <Panel title="Add or replace a rule" description="One rule per broker and category — saving an existing pair replaces it.">
        <RuleForm canAct={canAct} brokers={brokers} categories={catList} />
      </Panel>
    </div>
  );
}

function RuleForm({
  canAct,
  brokers,
  categories,
  rule,
}: {
  canAct: boolean;
  brokers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  rule?: { brokerOrgId: string; categoryId: string; priority: number; is_secondary: boolean; regions: string[]; segments: string[]; daily_capacity: number | null; active: boolean };
}) {
  return (
    <ActionForm action={saveRoutingRule} submitLabel="Save rule" readOnly={!canAct}>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Broker" htmlFor={`b-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`}>
          <Select id={`b-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} name="brokerOrgId" defaultValue={rule?.brokerOrgId ?? ""} required>
            <option value="">Choose…</option>
            {brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Category" htmlFor={`c-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`}>
          <Select id={`c-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} name="categoryId" defaultValue={rule?.categoryId ?? ""} required>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Priority" hint="Lower is preferred" htmlFor={`p-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`}>
          <Input id={`p-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} name="priority" type="number" min={0} defaultValue={rule?.priority ?? 100} required />
        </Field>
        <Field label="Regions" hint="Comma separated; empty = nationwide" htmlFor={`r-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} className="md:col-span-2">
          <Input id={`r-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} name="regions" defaultValue={rule?.regions.join(", ") ?? ""} placeholder="Greater Accra, Ashanti" />
        </Field>
        <Field label="Daily capacity" hint="Empty = unlimited" htmlFor={`d-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`}>
          <Input id={`d-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} name="daily_capacity" type="number" min={0} defaultValue={rule?.daily_capacity ?? ""} />
        </Field>
        <Field label="Segments" hint="personal, business, specialist; empty = all" htmlFor={`s-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} className="md:col-span-2">
          <Input id={`s-${rule?.brokerOrgId ?? "new"}-${rule?.categoryId ?? ""}`} name="segments" defaultValue={rule?.segments.join(", ") ?? ""} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox name="is_secondary" defaultChecked={rule?.is_secondary ?? false} label="Secondary (overflow) broker" />
          <Checkbox name="active" defaultChecked={rule?.active ?? true} label="Active" />
        </div>
      </div>
    </ActionForm>
  );
}
