import { Suspense } from "react";
import Link from "next/link";
import { Checkbox, Field, Input, Pill, Select } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, isUuid, orgMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, JsonView, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ToggleForm } from "@/components/ui/forms";
import { saveLineIntegration, toggleLineIntegration } from "./actions";

const MODE_TONE: Record<string, "ok" | "wait" | "neutral" | "danger"> = { insurer_direct: "ok", broker_fixed: "ok", broker_pool: "wait", ops_hold: "danger" };
const OFFER_TONE: Record<string, "ok" | "wait" | "neutral" | "danger"> = { offered: "wait", accepted: "ok", declined: "neutral", expired: "neutral", withdrawn: "neutral" };

export default function IntegrationsPage({ searchParams }: PageProps<"/routing/integrations">) {
  return (
    <>
      <PageHeader
        title="Insurer integrations & order routing"
        description="Integration level per insurer and product line (Addendum 2 A/D). Level 2/3 — or Level 1 with direct sales — sends orders straight to the insurer; nominated brokers restrict the broker pool. Advice requests and complex risks always go to a broker."
        actions={<Link href="/routing" className="text-sm text-brand hover:underline">Broker routing rules →</Link>}
      />
      <Suspense fallback={<LoadingBlock label="Loading integrations…" />}>
        <Integrations searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Integrations({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const [orgs, cats] = await Promise.all([orgMap(supabase), categoryMap(supabase)]);
  const insurer = sp(params, "insurer");
  const category = sp(params, "category");
  const requestQ = sp(params, "request")?.trim();
  let query = supabase.from("insurer_line_integrations").select("*").order("insurer_org_id").order("category_id");
  if (insurer) query = query.eq("insurer_org_id", insurer);
  if (category) query = query.eq("category_id", category);
  const { data: lines } = await query;
  const canAct = can(staff.roles, "network");
  const insurers = [...orgs.values()].filter((o) => o.type === "insurer" && o.status !== "offboarded");
  const brokers = [...orgs.values()].filter((o) => o.type === "broker" && o.status !== "offboarded");
  const catList = [...cats.values()];

  return (
    <div className="space-y-6">
      <RoutingLookup q={requestQ} orgs={orgs} />

      <div>
        <FilterBar action="/routing/integrations">
          <FilterSelect name="insurer" label="Insurer" value={insurer} options={insurers.map((i) => ({ value: i.id, label: i.name }))} />
          <FilterSelect name="category" label="Category" value={category} options={catList.map((c) => ({ value: c.id, label: c.name }))} />
        </FilterBar>
        <ReadOnlyBanner show={!canAct} />
        <Table>
          <THead><tr><Th>Insurer</Th><Th>Category</Th><Th>Level</Th><Th>Direct sales</Th><Th>Issuance</Th><Th>SLA</Th><Th>Nominated brokers</Th><Th>Active</Th><Th /></tr></THead>
          <tbody>
            {(lines ?? []).map((l) => {
              const direct = l.active && (l.level === "L2" || l.level === "L3" || (l.level === "L1" && l.direct_sales));
              return (
                <tr key={l.id} className="align-top">
                  <Td><Link href={`/organisations/${l.insurer_org_id}`} className="hover:text-brand">{orgs.get(l.insurer_org_id)?.name}</Link></Td>
                  <Td>{cats.get(l.category_id)?.name}</Td>
                  <Td><Pill tone={l.level === "L1" ? "neutral" : "ok"}>{l.level}</Pill></Td>
                  <Td>{direct ? <Pill tone="ok">Direct to insurer</Pill> : <Pill tone="wait">Via brokers</Pill>}</Td>
                  <Td className="text-xs">{l.issuance_type.replace(/_/g, " ")}</Td>
                  <Td className="tabular-nums">{l.sla_hours} h</Td>
                  <Td className="max-w-56 text-xs">{l.nominated_broker_org_ids.length ? l.nominated_broker_org_ids.map((id) => orgs.get(id)?.name ?? "?").join(", ") : "Any appointed"}</Td>
                  <Td><ToggleForm action={toggleLineIntegration} fields={{ integrationId: l.id }} checked={l.active} label="Integration active" disabled={!canAct} /></Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-sm text-brand">Edit</summary>
                      <div className="mt-3 w-[min(640px,80vw)]">
                        <LineForm canAct={canAct} insurers={insurers} brokers={brokers} categories={catList} line={l} />
                      </div>
                    </details>
                  </Td>
                </tr>
              );
            })}
            {!lines?.length && <tr><Td colSpan={9} className="py-8 text-center text-muted">No line integrations. Every insurer sells through brokers until one is added.</Td></tr>}
          </tbody>
        </Table>
      </div>

      <Panel title="Add or replace a line integration" description="One row per insurer and category — saving an existing pair replaces it. Insurers can later change direct sales and nominated brokers themselves.">
        <LineForm canAct={canAct} insurers={insurers} brokers={brokers} categories={catList} />
      </Panel>
    </div>
  );
}

/** Routing decision + offers for one request (by id or reference). */
async function RoutingLookup({ q, orgs }: { q: string | undefined; orgs: Map<string, { name: string }> }) {
  const supabase = await createClient();
  let request: { id: string; reference: string; status: string; broker_org_id: string | null; routing_mode: string | null; complexity_flags: string[]; talk_to_expert: boolean } | null = null;
  if (q) {
    const base = supabase.from("requests").select("id, reference, status, broker_org_id, routing_mode, complexity_flags, talk_to_expert");
    const { data } = isUuid(q) ? await base.eq("id", q).maybeSingle() : await base.ilike("reference", q).maybeSingle();
    request = data;
  }
  const [{ data: routing }, { data: offers }] = request
    ? await Promise.all([
        supabase.from("order_routing").select("*").eq("request_id", request.id).maybeSingle(),
        supabase.from("order_offers").select("id, broker_org_id, status, round, offered_at, responds_by, responded_at, decline_reason").eq("request_id", request.id).order("round").order("offered_at"),
      ])
    : [{ data: null }, { data: [] }];

  return (
    <Panel title="Routing decision for a request" description="Why a request went to an insurer, a fixed broker, a broker pool or ops — and every offer made.">
      <FilterBar action="/routing/integrations">
        <FilterInput name="request" label="Request id or reference" value={q} placeholder="REQ-1042 or uuid" />
      </FilterBar>
      {q && !request && <p className="mt-3 text-sm text-muted">No request matches “{q}”.</p>}
      {request && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/requests/${request.id}`} className="font-semibold text-brand hover:underline">{request.reference}</Link>
            <Pill tone="neutral">{request.status.replace(/_/g, " ")}</Pill>
            {routing ? <Pill tone={MODE_TONE[routing.mode] ?? "neutral"}>{routing.mode.replace(/_/g, " ")}</Pill> : <Pill tone="wait">Not routed by the engine</Pill>}
            {request.talk_to_expert && <Pill tone="wait">Talk to an expert</Pill>}
            {request.complexity_flags.map((f) => <Pill key={f} tone="neutral">{f.replace(/_/g, " ")}</Pill>)}
            <span className="text-muted">Broker of record: {request.broker_org_id ? orgs.get(request.broker_org_id)?.name : "—"}</span>
          </div>
          {routing && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="text-sm">
                <p className="text-ink">{routing.reason}</p>
                <p className="mt-1 text-xs text-muted">
                  Rule {routing.rule ?? "—"} · decided by {routing.decided_by} {formatDateTime(routing.decided_at)} · version {routing.version} · round {routing.current_round}/{routing.max_rounds} · batch {routing.offer_batch_size} · timeout {routing.offer_timeout_minutes} min
                  {routing.expires_at && ` · current round expires ${formatDateTime(routing.expires_at)}`}
                  {routing.insurer_org_id && ` · insurer ${orgs.get(routing.insurer_org_id)?.name}`}
                  {routing.broker_org_id && ` · fixed broker ${orgs.get(routing.broker_org_id)?.name}`}
                </p>
                <JsonView value={routing.candidates} className="mt-2 max-h-64" />
              </div>
              <div>
                <Table>
                  <THead><tr><Th>Round</Th><Th>Broker</Th><Th>Status</Th><Th>Offered</Th><Th>Respond by</Th><Th>Responded</Th></tr></THead>
                  <tbody>
                    {(offers ?? []).map((o) => (
                      <tr key={o.id}>
                        <Td className="tabular-nums">{o.round}</Td>
                        <Td>{orgs.get(o.broker_org_id)?.name}</Td>
                        <Td><Pill tone={OFFER_TONE[o.status] ?? "neutral"}>{o.status}</Pill>{o.decline_reason && <span className="ml-1 text-xs text-muted">{o.decline_reason}</span>}</Td>
                        <Td className="text-xs">{formatDateTime(o.offered_at)}</Td>
                        <Td className="text-xs">{formatDateTime(o.responds_by)}</Td>
                        <Td className="text-xs">{o.responded_at ? formatDateTime(o.responded_at) : "—"}</Td>
                      </tr>
                    ))}
                    {!offers?.length && <tr><Td colSpan={6} className="py-4 text-center text-muted">No offers (not a broker pool, or not routed yet).</Td></tr>}
                  </tbody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function LineForm({
  canAct,
  insurers,
  brokers,
  categories,
  line,
}: {
  canAct: boolean;
  insurers: { id: string; name: string }[];
  brokers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  line?: { id: string; insurer_org_id: string; category_id: string; level: string; direct_sales: boolean; sla_hours: number; issuance_type: string; nominated_broker_org_ids: string[]; active: boolean };
}) {
  const k = line?.id ?? "new";
  return (
    <ActionForm action={saveLineIntegration} submitLabel="Save integration" readOnly={!canAct}>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Insurer" htmlFor={`i-${k}`}>
          <Select id={`i-${k}`} name="insurerOrgId" defaultValue={line?.insurer_org_id ?? ""} required>
            <option value="">Choose…</option>
            {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <Field label="Category" htmlFor={`c-${k}`}>
          <Select id={`c-${k}`} name="categoryId" defaultValue={line?.category_id ?? ""} required>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Integration level" hint="L2/L3 route orders direct" htmlFor={`l-${k}`}>
          <Select id={`l-${k}`} name="level" defaultValue={line?.level ?? "L1"}>
            <option value="L1">L1 — referral / manual</option>
            <option value="L2">L2 — delegated issuance</option>
            <option value="L3">L3 — API connected</option>
          </Select>
        </Field>
        <Field label="Issuance" htmlFor={`t-${k}`}>
          <Select id={`t-${k}`} name="issuance_type" defaultValue={line?.issuance_type ?? "manual"}>
            <option value="instant">Instant</option>
            <option value="within_hours">Within hours</option>
            <option value="manual">Manual</option>
          </Select>
        </Field>
        <Field label="SLA (hours)" htmlFor={`s-${k}`}>
          <Input id={`s-${k}`} name="sla_hours" type="number" min={1} max={720} defaultValue={line?.sla_hours ?? 24} required />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox name="direct_sales" defaultChecked={line?.direct_sales ?? false} label="Direct sales at L1" />
          <Checkbox name="active" defaultChecked={line?.active ?? true} label="Active" />
        </div>
        <fieldset className="md:col-span-3">
          <legend className="text-sm font-medium text-ink-2">Nominated brokers (empty = any appointed broker)</legend>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
            {brokers.map((b) => (
              <Checkbox key={b.id} name="nominated" value={b.id} defaultChecked={line?.nominated_broker_org_ids.includes(b.id) ?? false} label={b.name} />
            ))}
            {!brokers.length && <p className="text-sm text-muted">No broker organisations.</p>}
          </div>
        </fieldset>
      </div>
    </ActionForm>
  );
}
