import { Suspense } from "react";
import Link from "next/link";
import { Checkbox, Field, Input, Pill, Select, Textarea, buttonClass } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import type { Row } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, pageOf, sp, withParams, type SearchParams } from "@/lib/query";
import { formatDate, formatDateTime, formatGHS, humanize } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Pagination, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { generateStatement, setCommercialTerms, transitionStatement } from "./actions";

const ENTRY_TYPES = ["premium_received", "premium_to_insurer", "broker_commission", "platform_fee", "revenue_share", "subscription_fee", "refund", "adjustment"];
const STATEMENT_TONE = { draft: "wait", issued: "info", paid: "ok" } as const;
const MODEL_LABEL: Record<string, string> = { revenue_share: "Revenue share", subscription: "Subscription", insurer_fee: "Insurer fee" };

export default function CommercialPage({ searchParams }: PageProps<"/commercial">) {
  return (
    <>
      <PageHeader
        title="Commercial terms & settlement"
        description="Per-partner commercial model, the money ledger and monthly settlement statements. Premiums settle to insurers; Covva only records commission and fee portions."
      />
      <Suspense fallback={<LoadingBlock label="Loading commercial data…" />}>
        <Commercial searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Commercial({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const canAct = can(staff.roles, "commercial");
  const orgs = await orgMap(supabase);
  const partners = [...orgs.values()].filter((o) => o.type === "broker" || o.type === "insurer");
  const org = sp(params, "org");
  const type = sp(params, "type");
  const from = sp(params, "from");
  const to = sp(params, "to");
  const { page, from: rangeFrom, to: rangeTo } = pageOf(params);
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);

  let ledger = supabase.from("ledger_entries").select("*", { count: "exact" }).order("id", { ascending: false }).range(rangeFrom, rangeTo);
  if (isUuid(org)) ledger = ledger.or(`org_id.eq.${org},counterparty_org_id.eq.${org}`);
  if (type && ENTRY_TYPES.includes(type)) ledger = ledger.eq("entry_type", type);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) ledger = ledger.gte("created_at", `${from}T00:00:00Z`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) ledger = ledger.lte("created_at", `${to}T23:59:59Z`);

  let statementsQ = supabase.from("settlement_statements").select("*").order("period_start", { ascending: false }).order("created_at", { ascending: false }).limit(60);
  if (isUuid(org)) statementsQ = statementsQ.eq("org_id", org);

  const [{ data: terms }, { data: plans }, { data: entries, count }, { data: statements }] = await Promise.all([
    supabase.from("org_commercial_terms").select("*").is("effective_to", null).order("created_at", { ascending: false }).limit(500),
    supabase.from("plans").select("id, name, audience, monthly_fee").eq("active", true).order("sort_order"),
    ledger,
    statementsQ,
  ]);
  const name = (id: string | null | undefined) => (id ? orgs.get(id)?.name ?? id.slice(0, 8) : "—");
  const money = (n: number | string) => formatGHS(Number(n), { decimals: true });
  const exportHref = withParams("/commercial/export", params, { page: undefined });

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Set commercial terms" description="Brokers: revenue share (Covva-sourced business) or subscription. Insurers: platform fee and the standard broker commission. Saving closes the previous terms and records your approval.">
          <ActionForm action={setCommercialTerms} submitLabel="Save and approve" readOnly={!canAct}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organisation" htmlFor="t-org">
                <Select id="t-org" name="orgId" required defaultValue={isUuid(org) ? org : ""}>
                  <option value="">Choose…</option>
                  {partners.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
                </Select>
              </Field>
              <Field label="Model" htmlFor="t-model">
                <Select id="t-model" name="model" required defaultValue="revenue_share">
                  <option value="revenue_share">Broker — revenue share</option>
                  <option value="subscription">Broker — subscription</option>
                  <option value="insurer_fee">Insurer — platform fee</option>
                </Select>
              </Field>
              <Field label="Revenue share % (of broker commission, Covva-sourced)" htmlFor="t-rs"><Input id="t-rs" name="revenueSharePct" type="number" step="0.01" min={0} max={100} defaultValue={0} /></Field>
              <Field label="Platform fee % (of net premium, insurer-side)" htmlFor="t-pf"><Input id="t-pf" name="platformFeePct" type="number" step="0.01" min={0} max={100} defaultValue={0} /></Field>
              <Field label="Broker commission % (of net premium)" htmlFor="t-bc" hint="Insurer: standard rate paid to brokers. Broker: agreed override (0 = insurer's rate)."><Input id="t-bc" name="brokerCommissionPct" type="number" step="0.01" min={0} max={100} defaultValue={0} /></Field>
              <Field label="Subscription plan (subscription model)" htmlFor="t-plan">
                <Select id="t-plan" name="planId" defaultValue="">
                  <option value="">—</option>
                  {(plans ?? []).filter((p) => p.audience === "broker").map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.monthly_fee)}/mo</option>)}
                </Select>
              </Field>
              <Field label="Effective from" htmlFor="t-from"><Input id="t-from" name="effectiveFrom" type="date" required defaultValue={today} /></Field>
              <Field label="Notes" htmlFor="t-notes" className="sm:col-span-2"><Textarea id="t-notes" name="notes" rows={2} placeholder="Reference to the signed partner agreement / schedule" /></Field>
            </div>
            <Checkbox name="approve" label="I confirm these terms were agreed with the partner (recorded as approval)" />
          </ActionForm>
        </Panel>

        <Panel title="Terms in force" description={`${(terms ?? []).length} organisation${(terms ?? []).length === 1 ? "" : "s"} with open terms`}>
          <Table>
            <THead><tr><Th>Organisation</Th><Th>Model</Th><Th>Rev. share</Th><Th>Platform fee</Th><Th>Commission</Th><Th>From</Th><Th>Approved</Th></tr></THead>
            <tbody>
              {(terms ?? []).map((t) => (
                <tr key={t.id}>
                  <Td><Link href={`/commercial?org=${t.org_id}`} className="font-medium text-ink hover:text-brand">{name(t.org_id)}</Link></Td>
                  <Td>{MODEL_LABEL[t.model] ?? humanize(t.model)}</Td>
                  <Td className="tabular-nums">{Number(t.revenue_share_pct)}%</Td>
                  <Td className="tabular-nums">{Number(t.platform_fee_pct)}%</Td>
                  <Td className="tabular-nums">{Number(t.broker_commission_pct)}%</Td>
                  <Td className="text-xs">{formatDate(t.effective_from)}</Td>
                  <Td className="text-xs">{t.approved_at ? formatDateTime(t.approved_at) : "—"}</Td>
                </tr>
              ))}
              {!terms?.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No commercial terms set yet.</Td></tr>}
            </tbody>
          </Table>
        </Panel>
      </div>

      <Panel
        title="Settlement statements"
        description="Drafted automatically on the 1st for the previous month. Regenerate refreshes a draft; issued statements are frozen. Lifecycle: draft → issued → paid."
      >
        <ActionForm action={generateStatement} submitLabel="Generate / refresh draft" readOnly={!canAct} inline className="mb-5">
          <Select name="orgId" required defaultValue={isUuid(org) ? org : ""} className="h-9 text-sm">
            <option value="">Organisation…</option>
            {partners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <Input name="period" type="month" required defaultValue={lastMonth} className="h-9 text-sm" />
        </ActionForm>
        <Table>
          <THead><tr><Th>Organisation</Th><Th>Period</Th><Th>Gross premium</Th><Th>Commission</Th><Th>Platform fee</Th><Th>Net due</Th><Th>Lines</Th><Th>Status</Th><Th /></tr></THead>
          <tbody>
            {((statements ?? []) as Row<"settlement_statements">[]).map((s) => (
              <tr key={s.id} className="hover:bg-mist/60">
                <Td className="font-medium text-ink">{name(s.org_id)}</Td>
                <Td className="text-xs">{formatDate(s.period_start)} – {formatDate(s.period_end)}</Td>
                <Td className="tabular-nums">{money(s.gross_premium)}</Td>
                <Td className="tabular-nums">{money(s.commission)}</Td>
                <Td className="tabular-nums">{money(s.platform_fee)}</Td>
                <Td className={`tabular-nums ${Number(s.net_due) < 0 ? "text-danger" : ""}`}>{money(s.net_due)}</Td>
                <Td className="tabular-nums">{s.line_count}</Td>
                <Td><Pill tone={STATEMENT_TONE[s.status as keyof typeof STATEMENT_TONE] ?? "neutral"}>{humanize(s.status)}</Pill>{s.issued_at && <span className="block text-[11px] text-muted">Issued {formatDate(s.issued_at)}</span>}</Td>
                <Td>
                  {canAct && s.status !== "paid" && (
                    <ActionForm action={transitionStatement} submitLabel={s.status === "draft" ? "Issue" : "Mark paid"} submitVariant="outline" inline>
                      <input type="hidden" name="statementId" value={s.id} />
                      <input type="hidden" name="to" value={s.status === "draft" ? "issued" : "paid"} />
                    </ActionForm>
                  )}
                </Td>
              </tr>
            ))}
            {!statements?.length && <tr><Td colSpan={9} className="py-8 text-center text-muted">No statements yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>

      <Panel
        title="Ledger"
        description="Append-only journal of every money movement. Amount is a credit to the organisation and a debit to the counterparty. Entries cannot be edited or deleted; corrections are adjustments."
        actions={<a href={exportHref} className={buttonClass("outline", "sm")}>Export CSV</a>}
      >
        <FilterBar action="/commercial" resetHref="/commercial">
          <FilterSelect name="org" label="Organisation" value={org} options={partners.map((o) => ({ value: o.id, label: o.name }))} />
          <FilterSelect name="type" label="Entry type" value={type} options={ENTRY_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
          <FilterInput name="from" label="From" value={from} type="date" />
          <FilterInput name="to" label="To" value={to} type="date" />
        </FilterBar>
        <Table>
          <THead><tr><Th>#</Th><Th>When</Th><Th>Entry</Th><Th>Credit to</Th><Th>Debit from</Th><Th className="text-right">Amount</Th><Th>Reference</Th></tr></THead>
          <tbody>
            {((entries ?? []) as Row<"ledger_entries">[]).map((e) => (
              <tr key={e.id} className="hover:bg-mist/60">
                <Td className="font-mono text-xs">{e.id}</Td>
                <Td className="text-xs">{formatDateTime(e.created_at)}</Td>
                <Td><span className="font-medium text-ink">{humanize(e.entry_type)}</span>{e.memo && <span className="block max-w-xs truncate text-xs text-muted" title={e.memo}>{e.memo}</span>}</Td>
                <Td>{name(e.org_id)}</Td>
                <Td>{e.counterparty_org_id ? name(e.counterparty_org_id) : <span className="text-muted">Customer</span>}</Td>
                <Td className="text-right tabular-nums">{e.currency} {Number(e.amount).toFixed(2)}</Td>
                <Td className="font-mono text-xs">{e.reference ?? "—"}{e.payment_id && <Link href={`/payments?q=${e.payment_id}`} className="ml-1 text-brand hover:underline">payment</Link>}</Td>
              </tr>
            ))}
            {!entries?.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No ledger entries match.</Td></tr>}
          </tbody>
        </Table>
        <Pagination base="/commercial" params={params} page={page} total={count} />
      </Panel>
    </div>
  );
}
