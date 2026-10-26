import { Suspense } from "react";
import type { Row } from "@im/db";
import { Checkbox, Field, Input, PageHeader, Pill, Select, Table, THead, Th, Td, Textarea } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatGHS } from "@/lib/format";
import { LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { savePlan } from "./actions";

export default function PlansPage() {
  return (
    <>
      <PageHeader title="Plans" description="SaaS plans for brokers, insurers and enterprise clients. Indicative pricing until agreed in heads of terms. Platform revenue comes from these fees — never from premiums." />
      <Suspense fallback={<LoadingBlock label="Loading plans…" />}>
        <Plans />
      </Suspense>
    </>
  );
}

async function Plans() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: plans }, { data: subs }] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("subscriptions").select("plan_id, status").in("status", ["trialing", "active", "past_due"]),
  ]);
  const canAct = can(staff.roles, "commercial");
  return (
    <div className="space-y-6">
      <ReadOnlyBanner show={!canAct} />
      <Table>
        <THead><tr><Th>Plan</Th><Th>Audience</Th><Th>Monthly</Th><Th>Included</Th><Th>Usage fees</Th><Th>Subscribers</Th><Th>Status</Th><Th /></tr></THead>
        <tbody>
          {(plans ?? []).map((p) => {
            const n = (subs ?? []).filter((s) => s.plan_id === p.id);
            return (
              <tr key={p.id} className="align-top">
                <Td><p className="font-semibold text-ink">{p.name}</p><p className="font-mono text-xs text-muted">{p.code}</p></Td>
                <Td className="capitalize">{p.audience}</Td>
                <Td className="tabular-nums">{formatGHS(Number(p.monthly_fee))}</Td>
                <Td className="text-xs">{p.included_seats ?? "∞"} seats · {p.included_requests ?? "∞"} requests</Td>
                <Td className="text-xs">{formatGHS(Number(p.per_request_fee), { decimals: true })}/request over · {formatGHS(Number(p.per_active_policy_fee), { decimals: true })}/active policy</Td>
                <Td>{n.length} <span className="text-xs text-muted">({n.filter((s) => s.status === "trialing").length} trial)</span></Td>
                <Td>{p.active ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-sm text-brand">Edit</summary>
                    <div className="mt-3 w-[min(640px,80vw)]"><PlanForm plan={p} canAct={canAct} /></div>
                  </details>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Panel title="New plan">
        <PlanForm canAct={canAct} />
      </Panel>
    </div>
  );
}

function PlanForm({ plan, canAct }: { plan?: Row<"plans">; canAct: boolean }) {
  const idp = plan?.id ?? "new";
  return (
    <ActionForm action={savePlan} submitLabel={plan ? "Save plan" : "Create plan"} readOnly={!canAct}>
      <input type="hidden" name="planId" value={plan?.id ?? ""} />
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Code" htmlFor={`code-${idp}`}><Input id={`code-${idp}`} name="code" required defaultValue={plan?.code ?? ""} /></Field>
        <Field label="Name" htmlFor={`name-${idp}`}><Input id={`name-${idp}`} name="name" required defaultValue={plan?.name ?? ""} /></Field>
        <Field label="Audience" htmlFor={`aud-${idp}`}>
          <Select id={`aud-${idp}`} name="audience" defaultValue={plan?.audience ?? "broker"}>
            <option value="broker">Broker</option><option value="insurer">Insurer</option><option value="enterprise">Enterprise</option>
          </Select>
        </Field>
        <Field label="Monthly fee (GH₵)" htmlFor={`fee-${idp}`}><Input id={`fee-${idp}`} name="monthly_fee" type="number" step="0.01" min={0} defaultValue={plan?.monthly_fee ?? 0} /></Field>
        <Field label="Included seats" htmlFor={`seats-${idp}`} hint="Empty = unlimited"><Input id={`seats-${idp}`} name="included_seats" type="number" min={0} defaultValue={plan?.included_seats ?? ""} /></Field>
        <Field label="Included requests / month" htmlFor={`req-${idp}`} hint="Empty = unlimited"><Input id={`req-${idp}`} name="included_requests" type="number" min={0} defaultValue={plan?.included_requests ?? ""} /></Field>
        <Field label="Fee per request over allowance" htmlFor={`prf-${idp}`}><Input id={`prf-${idp}`} name="per_request_fee" type="number" step="0.01" min={0} defaultValue={plan?.per_request_fee ?? 0} /></Field>
        <Field label="Fee per active policy" htmlFor={`pap-${idp}`}><Input id={`pap-${idp}`} name="per_active_policy_fee" type="number" step="0.01" min={0} defaultValue={plan?.per_active_policy_fee ?? 0} /></Field>
        <Field label="Sort order" htmlFor={`so-${idp}`}><Input id={`so-${idp}`} name="sort_order" type="number" defaultValue={plan?.sort_order ?? 100} /></Field>
        <Field label="Description" htmlFor={`desc-${idp}`} className="md:col-span-3"><Input id={`desc-${idp}`} name="description" defaultValue={plan?.description ?? ""} /></Field>
        <Field label="Features (one per line)" htmlFor={`feat-${idp}`} className="md:col-span-2">
          <Textarea id={`feat-${idp}`} name="features" defaultValue={Array.isArray(plan?.features) ? (plan.features as string[]).join("\n") : ""} className="min-h-24" />
        </Field>
        <div className="flex items-end pb-2"><Checkbox name="active" defaultChecked={plan?.active ?? true} label="Active (offered to new subscribers)" /></div>
      </div>
    </ActionForm>
  );
}
