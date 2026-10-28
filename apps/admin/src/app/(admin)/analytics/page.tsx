import { Suspense } from "react";
import { PageHeader, Table, THead, Th, Td } from "@im/ui";
import { FACT_METRICS, PREMIUM_BANDS, factKeyLabel, funnelRates, sumFacts, type FactMetric } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, isUuid, orgMap, sp, type SearchParams } from "@/lib/query";
import { fmtNum, fmtPct, formatDate, formatGHS } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, Kpi, LoadingBlock, Panel } from "@/components/ui/layout";
import { Bars, HBars } from "@/components/ui/charts";
import { ActionForm } from "@/components/ui/forms";
import { runRollup } from "./actions";

export default function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Analytics"
        description="Funnel, pricing distribution, renewals, claims and payment outcomes from the daily facts in the analytics schema (no personal data). Pick a date range and break it down by category, region or partner."
      />
      <Suspense fallback={<LoadingBlock label="Loading analytics…" rows={10} />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type FactsRow = { key: string } & Record<FactMetric, number>;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const today = new Date();
  const to = DATE_RE.test(sp(params, "to") ?? "") ? sp(params, "to")! : isoDate(today);
  const from = DATE_RE.test(sp(params, "from") ?? "") ? sp(params, "from")! : isoDate(new Date(today.getTime() - 29 * 86_400_000));
  const category = sp(params, "category");
  const region = sp(params, "region");
  const broker = sp(params, "broker");
  const insurer = sp(params, "insurer");
  const filters = { p_from: from, p_to: to, p_category_id: isUuid(category) ? category : undefined, p_region: region || undefined, p_broker_org_id: isUuid(broker) ? broker : undefined, p_insurer_org_id: isUuid(insurer) ? insurer : undefined };

  const facts = async (group: string) => {
    const { data, error } = await supabase.rpc("analytics_facts", { ...filters, p_group: group });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      // Facts with no region / partner come back with a NULL key: keep it a string so grouping never crashes.
      const out = { key: r.key == null ? "" : String(r.key) } as FactsRow;
      for (const m of FACT_METRICS) out[m] = Number(r[m] ?? 0) || 0;
      return out;
    });
  };
  const [byDay, byCategory, byRegion, byBroker, byInsurer, cats, orgs, { data: runs }] = await Promise.all([
    facts("day"),
    facts("category"),
    facts("region"),
    facts("broker"),
    facts("insurer"),
    categoryMap(supabase),
    orgMap(supabase),
    supabase.rpc("analytics_facts", { p_from: from, p_to: to, p_group: "total" }).then(() => supabase.from("platform_settings").select("value").eq("key", "cron_last_run:analytics-rollup").maybeSingle()),
  ]);
  const totals = sumFacts(byDay);
  const rates = funnelRates(totals);
  const lastRun = (runs?.value as { at?: string; ok?: boolean } | null) ?? null;
  const name = (kind: "category" | "region" | "broker" | "insurer", key: string | null | undefined) =>
    factKeyLabel(key, (k) => (kind === "category" ? cats.get(k)?.name : kind === "region" ? k : orgs.get(k)?.name));
  const breakdown = (rows: FactsRow[], kind: "category" | "region" | "broker" | "insurer", metric: FactMetric) =>
    rows.filter((r) => r[metric] > 0).sort((a, b) => b[metric] - a[metric]).slice(0, 8).map((r) => ({ label: name(kind, r.key), value: r[metric] }));
  const premiumBands = PREMIUM_BANDS.map((b) => ({ label: b.label, value: totals[`premium_${b.key.replace("from_", "").replace("_to_", "_to_")}` as FactMetric] ?? 0 }));
  const bandValue: Record<string, number> = { under_500: totals.premium_under_500, from_500_to_2k: totals.premium_500_to_2k, from_2k_to_10k: totals.premium_2k_to_10k, over_10k: totals.premium_over_10k };
  for (const b of premiumBands) b.value = bandValue[PREMIUM_BANDS.find((x) => x.label === b.label)!.key] ?? 0;
  const avgPremium = totals.policies_issued ? totals.premium_sum / totals.policies_issued : null;
  const canRun = can(staff.roles, "platform");

  return (
    <div className="space-y-6">
      <FilterBar action="/analytics">
        <FilterInput name="from" label="From" value={from} type="date" />
        <FilterInput name="to" label="To" value={to} type="date" />
        <FilterSelect name="category" label="Category" value={category} options={[...cats.values()].map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="region" label="Region" value={region} options={byRegion.filter((r) => r.key && r.key !== "null").map((r) => ({ value: r.key, label: name("region", r.key) }))} />
        <FilterSelect name="broker" label="Broker" value={broker} options={[...orgs.values()].filter((o) => o.type === "broker").map((o) => ({ value: o.id, label: o.name }))} />
        <FilterSelect name="insurer" label="Insurer" value={insurer} options={[...orgs.values()].filter((o) => o.type === "insurer").map((o) => ({ value: o.id, label: o.name }))} />
      </FilterBar>

      <section aria-label="Funnel" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Requests" value={fmtNum(totals.requests)} hint={`${formatDate(from)} – ${formatDate(to)}`} />
        <Kpi label="Quotes" value={fmtNum(totals.quotes)} hint={`${fmtNum(totals.binding_quotes)} binding · ${rates.quotesPerRequest ?? "—"} per request`} />
        <Kpi label="Conversions" value={fmtNum(totals.conversions)} hint={`${fmtPct(rates.requestToConversion == null ? null : rates.requestToConversion * 100)} of requests`} />
        <Kpi label="Policies issued" value={fmtNum(totals.policies_issued)} hint={`${fmtPct(rates.requestToPolicy == null ? null : rates.requestToPolicy * 100)} request → policy`} tone="ok" />
        <Kpi label="Premium arranged" value={formatGHS(totals.premium_sum)} hint={avgPremium == null ? "No policies in range" : `${formatGHS(avgPremium)} average · settles to insurers`} />
      </section>
      <section aria-label="Renewals, claims and payments" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Renewals due" value={fmtNum(totals.renewals_due)} hint={`${fmtNum(totals.renewals_renewed)} renewed · ${totals.renewals_due ? fmtPct((totals.renewals_renewed / totals.renewals_due) * 100) : "—"} retention`} />
        <Kpi label="Claims opened" value={fmtNum(totals.claims_opened)} hint={`${fmtNum(totals.claims_settled)} settled`} />
        <Kpi label="Payments succeeded" value={fmtNum(totals.payments_succeeded)} hint={`${fmtNum(totals.payments_failed)} failed`} tone={totals.payments_failed > totals.payments_succeeded ? "warn" : "default"} />
        <Kpi label="Rollup" value={lastRun?.at ? formatDate(lastRun.at) : "never"} hint={lastRun ? `Last cron run ${lastRun.ok ? "ok" : "failed"} · nightly 01:50` : "cron analytics-rollup not run yet"} tone={lastRun && !lastRun.ok ? "danger" : "default"} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Funnel per day" description="Requests, quotes and policies issued per day (hover for values).">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Requests</p>
          <Bars data={byDay.map((d) => ({ label: formatDate(d.key), value: d.requests }))} height={90} />
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Quotes</p>
          <Bars data={byDay.map((d) => ({ label: formatDate(d.key), value: d.quotes }))} height={90} />
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Policies issued</p>
          <Bars data={byDay.map((d) => ({ label: formatDate(d.key), value: d.policies_issued }))} height={90} />
        </Panel>
        <Panel title="Pricing distribution" description="Policies issued by annual premium band (GHS).">
          <HBars data={premiumBands} />
          <Table className="mt-5">
            <THead><tr><Th>Band</Th><Th>Policies</Th><Th>Share</Th></tr></THead>
            <tbody>
              {premiumBands.map((b) => (
                <tr key={b.label}><Td>{b.label}</Td><Td className="tabular-nums">{fmtNum(b.value)}</Td><Td className="tabular-nums">{totals.policies_issued ? fmtPct((b.value / totals.policies_issued) * 100) : "—"}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel title="Renewals per day" description="Policies due for renewal and renewed, by cover end date.">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Due</p>
          <Bars data={byDay.map((d) => ({ label: formatDate(d.key), value: d.renewals_due }))} height={80} />
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Renewed</p>
          <Bars data={byDay.map((d) => ({ label: formatDate(d.key), value: d.renewals_renewed }))} height={80} />
        </Panel>
        <Panel title="Claims per day" description="Claims opened and settled (paid).">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Opened</p>
          <Bars data={byDay.map((d) => ({ label: formatDate(d.key), value: d.claims_opened }))} height={80} />
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Settled</p>
          <Bars data={byDay.map((d) => ({ label: formatDate(d.key), value: d.claims_settled }))} height={80} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="By category" description="Requests, policies and claims per product category.">
          <BreakdownTable rows={byCategory} kind="category" name={name} />
        </Panel>
        <Panel title="By region" description="From the request's region (Ghana regions only; no addresses).">
          <BreakdownTable rows={byRegion} kind="region" name={name} />
        </Panel>
        <Panel title="By broker" description="Broker of record on the request, quote or policy.">
          <HBars data={breakdown(byBroker, "broker", "requests")} />
          <BreakdownTable rows={byBroker} kind="broker" name={name} className="mt-5" />
        </Panel>
        <Panel title="By insurer" description="Quotes, policies issued and claims per insurer.">
          <HBars data={breakdown(byInsurer, "insurer", "quotes")} />
          <BreakdownTable rows={byInsurer} kind="insurer" name={name} className="mt-5" />
        </Panel>
      </div>

      <Panel title="Rollup" description="Facts are rebuilt per day (idempotent). Use a dry run to count rows without writing; backfill after applying the migration or after a data correction.">
        {canRun ? (
          <ActionForm action={runRollup} submitLabel="Run rollup" inline>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">From<input name="from" type="date" defaultValue={from} className="h-9 rounded-[10px] border border-line bg-white px-2.5 text-sm text-ink" required /></label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">To<input name="to" type="date" defaultValue={to} className="h-9 rounded-[10px] border border-line bg-white px-2.5 text-sm text-ink" required /></label>
            <label className="flex h-9 items-center gap-2 self-end rounded-[10px] border border-line bg-white px-3 text-sm text-ink-2"><input type="checkbox" name="dry_run" value="1" className="size-4 accent-brand" /> Dry run</label>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">Platform admins can run or backfill the rollup.</p>
        )}
      </Panel>
      <p className="text-xs text-subtle">Facts carry no personal data. Insurers see a suppressed, anonymised monthly subset in their workspace (Market insight). Definitions: docs/SCORECARDS_ANALYTICS.md.</p>
    </div>
  );
}

function BreakdownTable({ rows, kind, name, className }: { rows: FactsRow[]; kind: "category" | "region" | "broker" | "insurer"; name: (k: typeof kind, key: string | null | undefined) => string; className?: string }) {
  const sorted = [...rows].sort((a, b) => b.requests + b.quotes + b.policies_issued - (a.requests + a.quotes + a.policies_issued)).slice(0, 12);
  return (
    <Table className={className}>
      <THead><tr><Th>{kind[0]!.toUpperCase() + kind.slice(1)}</Th><Th>Requests</Th><Th>Quotes</Th><Th>Policies</Th><Th>Premium</Th><Th>Renewed / due</Th><Th>Claims opened / settled</Th></tr></THead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.key || "not-recorded"}>
            <Td className="font-medium text-ink">{name(kind, r.key)}</Td>
            <Td className="tabular-nums">{fmtNum(r.requests)}</Td>
            <Td className="tabular-nums">{fmtNum(r.quotes)}</Td>
            <Td className="tabular-nums">{fmtNum(r.policies_issued)}</Td>
            <Td className="tabular-nums">{formatGHS(r.premium_sum)}</Td>
            <Td className="tabular-nums">{fmtNum(r.renewals_renewed)} / {fmtNum(r.renewals_due)}</Td>
            <Td className="tabular-nums">{fmtNum(r.claims_opened)} / {fmtNum(r.claims_settled)}</Td>
          </tr>
        ))}
        {!sorted.length && <tr><Td colSpan={7} className="py-6 text-center text-muted">No facts in this range. Run the rollup below.</Td></tr>}
      </tbody>
    </Table>
  );
}
