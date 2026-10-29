import { Suspense } from "react";
import { TriangleAlert } from "lucide-react";
import { ACCOUNTING_EXPORT_KINDS, ACCOUNTING_EXPORT_LABEL, commissionReport, monthPeriod, type LedgerEntryLike } from "@im/core";
import { Field, Input, Notice, Pill, Select, Textarea } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime, formatGHS } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { generateExport, saveTaxRule } from "./actions";

export default function AccountingPage({ searchParams }: PageProps<"/accounting">) {
  return (
    <>
      <PageHeader title="Accounting" description="Platform revenue, accounting exports per organisation, and VAT / levy rules. Premiums settle to insurers; Covva's revenue is platform fees, revenue share and subscriptions." />
      <Suspense fallback={<LoadingBlock label="Loading accounting…" />}>
        <Accounting searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_TONE = { needs_confirmation: "wait", active: "ok", retired: "neutral" } as const;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function Accounting({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const canAct = can(staff.roles, "commercial");
  const supabase = await createClient();
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const month = sp(params, "month") ?? months[1]!;
  const period = monthPeriod(month) ?? monthPeriod(months[1]!)!;
  const orgs = await orgMap(supabase);
  const platform = [...orgs.values()].find((o) => o.type === "platform");
  const partners = [...orgs.values()].filter((o) => o.type === "insurer" || o.type === "broker").sort((a, b) => a.name.localeCompare(b.name));

  const [{ data: ledger }, { data: rules }, { data: exports }] = await Promise.all([
    supabase.from("ledger_entries").select("id, created_at, entry_type, org_id, counterparty_org_id, amount, currency, memo, reference, policy_id").gte("created_at", `${period.start}T00:00:00Z`).lt("created_at", `${nextDay(period.end)}T00:00:00Z`).limit(20000),
    supabase.from("tax_rules").select("*").order("code"),
    supabase.from("accounting_exports").select("*").order("created_at", { ascending: false }).limit(40),
  ]);
  const entries = (ledger ?? []) as LedgerEntryLike[];
  const sum = (types: string[]) => entries.filter((e) => platform && e.org_id === platform.id && types.includes(e.entry_type)).reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0) / 100;
  const fees = sum(["platform_fee"]);
  const share = sum(["revenue_share"]);
  const subs = sum(["subscription_fee"]);
  const reversals = entries.filter((e) => platform && e.org_id === platform.id && e.entry_type === "adjustment").reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0) / 100;
  const premiums = entries.filter((e) => e.entry_type === "premium_received").reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0) / 100;
  const commission = commissionReport(entries).totals.netCommission;
  const pending = (rules ?? []).filter((r) => r.status === "needs_confirmation");

  return (
    <div className="space-y-6">
      <ReadOnlyBanner show={!canAct} />
      <FilterBar action="/accounting">
        <FilterSelect name="month" label="Month" value={month} options={months.map((m) => ({ value: m, label: m }))} />
      </FilterBar>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Platform fees" value={formatGHS(fees)} />
        <Kpi label="Revenue share" value={formatGHS(share)} />
        <Kpi label="Subscriptions" value={formatGHS(subs)} />
        <Kpi label="Reversals" value={formatGHS(reversals)} />
        <Kpi label="Premiums to insurers" value={formatGHS(premiums)} />
        <Kpi label="Broker commission" value={formatGHS(commission)} />
      </div>

      <Panel title="Tax rules" description="VAT and levies on Covva's fees, broker commission, premiums and subscriptions. Rates are percentages and are applied only once a rule is active.">
        {pending.length > 0 && (
          <Notice tone="wait" icon={<TriangleAlert className="size-4" />} title={`${pending.length} tax rule${pending.length === 1 ? "" : "s"} need confirmation`} className="mb-4">
            Rates are not hard-coded. Most insurance premiums are VAT-exempt in Ghana, but platform and broker fees may be VATable, and levies (NHIL, GETFund, COVID-19 levy, NIC and Fire Service levies) change with each budget. Confirm each rate, its base and who remits it with the finance team / tax adviser before activating. Until then tax reports list these rules as &ldquo;not applied&rdquo;.
          </Notice>
        )}
        <div className="space-y-3">
          {(rules ?? []).map((r) => (
            <details key={r.id} className="rounded-xl border border-line p-3">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                <span><span className="font-semibold text-ink">{r.code}</span> · {r.name} · applies to {r.applies_to.replace(/_/g, " ")}</span>
                <span className="flex items-center gap-2">{r.rate != null ? <span className="font-mono text-xs">{Number(r.rate)}%{r.inclusive ? " incl." : ""}</span> : <span className="text-xs text-muted">no rate</span>}<Pill tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Pill></span>
              </summary>
              {r.description && <p className="mt-2 text-xs text-muted">{r.description}</p>}
              {r.confirmed_at && <p className="mt-1 text-xs text-subtle">Confirmed {formatDateTime(r.confirmed_at)}</p>}
              <ActionForm action={saveTaxRule} submitLabel="Save rule" readOnly={!canAct} className="mt-3">
                <input type="hidden" name="ruleId" value={r.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Rate (%)" htmlFor={`rate-${r.id}`}><Input id={`rate-${r.id}`} name="rate" type="number" step="0.0001" min={0} max={100} defaultValue={r.rate ?? ""} /></Field>
                  <Field label="Applies to" htmlFor={`base-${r.id}`}>
                    <Select id={`base-${r.id}`} name="applies_to" defaultValue={r.applies_to}>
                      <option value="platform_fee">Platform fees</option>
                      <option value="broker_commission">Broker commission</option>
                      <option value="premium">Premiums</option>
                      <option value="subscription">Subscriptions</option>
                    </Select>
                  </Field>
                  <Field label="Status" htmlFor={`st-${r.id}`}>
                    <Select id={`st-${r.id}`} name="status" defaultValue={r.status}>
                      <option value="needs_confirmation">Needs confirmation</option>
                      <option value="active">Active (rate confirmed)</option>
                      <option value="retired">Retired</option>
                    </Select>
                  </Field>
                  <Field label="Effective from" htmlFor={`ef-${r.id}`}><Input id={`ef-${r.id}`} name="effective_from" type="date" defaultValue={r.effective_from} /></Field>
                  <Field label="Effective to (optional)" htmlFor={`et-${r.id}`}><Input id={`et-${r.id}`} name="effective_to" type="date" defaultValue={r.effective_to ?? ""} /></Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="inclusive" defaultChecked={r.inclusive} className="size-4" /> Base already includes the tax</label>
                </div>
                <Field label="Notes" htmlFor={`d-${r.id}`}><Textarea id={`d-${r.id}`} name="description" rows={2} defaultValue={r.description ?? ""} /></Field>
              </ActionForm>
            </details>
          ))}
        </div>
      </Panel>

      <Panel title="Generate an export" description="Builds a CSV from the ledger for an organisation (or the platform) and stores it privately. The monthly cron (2nd, 04:00) produces insurer statements and commission reports automatically.">
        <ActionForm action={generateExport} submitLabel="Generate" readOnly={!canAct}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Report" htmlFor="x-kind">
              <Select id="x-kind" name="kind" defaultValue="platform_revenue">{ACCOUNTING_EXPORT_KINDS.map((k) => <option key={k} value={k}>{ACCOUNTING_EXPORT_LABEL[k]}</option>)}</Select>
            </Field>
            <Field label="Organisation" htmlFor="x-org" hint="Leave as platform for Covva's own books">
              <Select id="x-org" name="orgId" defaultValue="">
                <option value="">Platform (Covva)</option>
                {partners.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
              </Select>
            </Field>
            <Field label="Month" htmlFor="x-month">
              <Select id="x-month" name="month" defaultValue={month}>{months.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
            </Field>
          </div>
        </ActionForm>
      </Panel>

      <Panel title="Exports" description="Most recent 40 exports across organisations.">
        <Table>
          <THead><tr><Th>Report</Th><Th>Organisation</Th><Th>Period</Th><Th>Rows</Th><Th>Status</Th><Th>Created</Th><Th>&nbsp;</Th></tr></THead>
          <tbody>
            {(exports ?? []).map((x) => (
              <tr key={x.id}>
                <Td>{ACCOUNTING_EXPORT_LABEL[x.kind as keyof typeof ACCOUNTING_EXPORT_LABEL] ?? x.kind}</Td>
                <Td>{x.org_id ? orgs.get(x.org_id)?.name ?? x.org_id : "Platform"}</Td>
                <Td className="whitespace-nowrap">{x.period_start} – {x.period_end}</Td>
                <Td>{x.row_count ?? "—"}</Td>
                <Td><Pill tone={x.status === "ready" ? "ok" : x.status === "failed" ? "danger" : "wait"}>{x.status}</Pill>{x.error && <p className="text-xs text-danger">{x.error}</p>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(x.created_at)}</Td>
                <Td>{x.status === "ready" && <a href={`/accounting/download?id=${x.id}`} className="text-sm font-semibold text-brand hover:underline">Download</a>}</Td>
              </tr>
            ))}
            {!(exports ?? []).length && <tr><Td colSpan={7} className="text-muted">No exports yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
