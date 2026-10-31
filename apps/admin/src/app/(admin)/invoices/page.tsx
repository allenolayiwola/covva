import { partnerBillingEnabled } from "@/lib/partner-billing";
import { Suspense } from "react";
import Link from "next/link";
import { Field, Input, Pill, Select } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, pageOf, sp, type SearchParams } from "@/lib/query";
import { formatDate, formatGHS } from "@/lib/format";
import { FilterBar, FilterSelect, LoadingBlock, Pagination, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { generateInvoice } from "./actions";
import { INVOICE_TONE } from "./meta";

const STATUSES: Enum<"invoice_status">[] = ["draft", "issued", "paid", "void"];

export default function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  return (
    <>
      <PageHeader title="Invoices" description="Partner invoices. Premiums are never invoiced by the platform." />
      <Suspense fallback={<LoadingBlock label="Loading invoices…" />}>
        <Invoices searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Invoices({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  if (!await partnerBillingEnabled(supabase)) return <p>Partner platform-fee billing is disabled. Enable partner_platform_fee in Feature flags after review.</p>;
  const orgs = await orgMap(supabase);
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const org = sp(params, "org");
  let query = supabase.from("invoices").select("id, number, org_id, period_start, period_end, total, currency, status, issued_at, due_on, paid_at", { count: "exact" }).order("period_start", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
  if (status && (STATUSES as string[]).includes(status)) query = query.eq("status", status as Enum<"invoice_status">);
  if (isUuid(org)) query = query.eq("org_id", org);
  const { data, count } = await query;
  const canAct = can(staff.roles, "commercial");
  const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const billable = [...orgs.values()].filter((o) => o.type !== "platform");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Panel title="Generate draft invoice" description="Builds lines from the live plan and the month's usage. Drafts can be reviewed before issuing.">
        <ActionForm action={generateInvoice} submitLabel="Generate draft" readOnly={!canAct}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Organisation" htmlFor="g-org">
              <Select id="g-org" name="orgId" required defaultValue={isUuid(org) ? org : ""}>
                <option value="">Choose…</option>
                {billable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
            <Field label="Billing month" htmlFor="g-period"><Input id="g-period" name="period" type="month" required defaultValue={lastMonth} /></Field>
          </div>
        </ActionForm>
      </Panel>
      <div>
        <FilterBar action="/invoices">
          <FilterSelect name="status" label="Status" value={status} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <FilterSelect name="org" label="Organisation" value={org} options={billable.map((o) => ({ value: o.id, label: o.name }))} />
        </FilterBar>
        <Table>
          <THead><tr><Th>Invoice</Th><Th>Organisation</Th><Th>Period</Th><Th>Total</Th><Th>Status</Th><Th>Due</Th></tr></THead>
          <tbody>
            {(data ?? []).map((i) => {
              const overdue = i.status === "issued" && i.due_on && i.due_on < today;
              return (
                <tr key={i.id} className="hover:bg-mist/60">
                  <Td><Link href={`/invoices/${i.id}`} className="font-mono text-sm font-semibold text-ink hover:text-brand">{i.number}</Link></Td>
                  <Td>{orgs.get(i.org_id)?.name}</Td>
                  <Td className="text-xs">{formatDate(i.period_start)} – {formatDate(i.period_end)}</Td>
                  <Td className="tabular-nums">{formatGHS(Number(i.total), { decimals: true })}</Td>
                  <Td><Pill tone={INVOICE_TONE[i.status]}>{i.status}</Pill>{overdue && <Pill tone="danger" className="ml-1">past due date</Pill>}</Td>
                  <Td className="text-xs">{i.paid_at ? `Paid ${formatDate(i.paid_at)}` : formatDate(i.due_on)}</Td>
                </tr>
              );
            })}
            {!data?.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No invoices.</Td></tr>}
          </tbody>
        </Table>
        <Pagination base="/invoices" params={params} page={page} total={count} />
      </div>
    </div>
  );
}
