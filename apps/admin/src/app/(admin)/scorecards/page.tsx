import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { SCORE_BAND_LABEL, formatDuration } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, LoadingBlock, Panel } from "@/components/ui/layout";
import { HBars } from "@/components/ui/charts";
import { ActionForm } from "@/components/ui/forms";
import { refreshScorecards } from "./actions";

export default function ScorecardsPage({ searchParams }: PageProps<"/scorecards">) {
  return (
    <>
      <PageHeader
        eyebrow="Network"
        title="Broker scorecards"
        description="Composite service score per broker (0–100) from first response, quote fulfilment, issuance, claims support, service levels and approved ratings. Refreshed nightly by the scorecard-refresh job; the 90-day score nudges pool routing within platform_settings.routing.scorecard_weight."
      />
      <Suspense fallback={<LoadingBlock label="Loading scorecards…" />}>
        <Scorecards searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const BAND_TONE = { excellent: "ok", good: "ok", fair: "wait", needs_attention: "danger", new: "neutral" } as const;

async function Scorecards({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const canRefresh = can(staff.roles, "platform");
  const params = await searchParams;
  const window = sp(params, "window") === "30" ? 30 : 90;
  const supabase = await createClient();
  const [{ data: cards }, orgs, { data: pending }, { data: weight }] = await Promise.all([
    supabase.from("broker_scorecards").select("*").eq("window_days", window).order("score", { ascending: false, nullsFirst: false }).limit(1000),
    orgMap(supabase),
    supabase.from("broker_reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("platform_settings").select("value").eq("key", "routing.scorecard_weight").maybeSingle(),
  ]);
  const rows = cards ?? [];
  const bands = ["excellent", "good", "fair", "needs_attention", "new"].map((b) => ({ label: SCORE_BAND_LABEL[b as keyof typeof SCORE_BAND_LABEL], value: rows.filter((r) => r.score_band === b).length }));
  const lastRun = rows.reduce<string | null>((m, r) => (m == null || r.computed_at > m ? r.computed_at : m), null);
  void pending;

  return (
    <div className="space-y-6">
      <FilterBar action="/scorecards">
        <FilterSelect name="window" label="Window" value={String(window)} allLabel="Last 90 days" options={[{ value: "30", label: "Last 30 days" }]} />
      </FilterBar>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Brokers by band" description={lastRun ? `Last refresh ${formatDateTime(lastRun)}` : "Not refreshed yet"}>
          <HBars data={bands} />
        </Panel>
        <Panel title="Routing weight" description="platform_settings.routing.scorecard_weight">
          <p className="text-3xl font-bold tabular-nums text-ink">±{weight?.value == null ? 10 : Number(weight.value)} pts</p>
          <p className="mt-1 text-xs text-muted">Maximum nudge from the 90-day score in pool ranking. 0 disables. Change it in <Link href="/settings" className="text-brand hover:underline">Settings</Link>.</p>
        </Panel>
        <Panel title="Review moderation">
          <p className="text-sm text-ink-2">Customer reviews are checked before they are shown.</p>
          <Link href="/scorecards/reviews" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Open the moderation queue →</Link>
        </Panel>
      </div>
      <Table>
        <THead><tr><Th>Broker</Th><Th>Score</Th><Th>Band</Th><Th>First response</Th><Th>Quoted</Th><Th>Issuance</Th><Th>Claims</Th><Th>Service levels</Th><Th>Rating</Th><Th>Requests</Th></tr></THead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td><Link href={`/organisations/${r.broker_org_id}`} className="font-medium text-ink hover:text-brand">{orgs.get(r.broker_org_id)?.name ?? r.broker_org_id.slice(0, 8)}</Link></Td>
              <Td className="tabular-nums font-semibold text-ink">{r.score == null ? "—" : Math.round(Number(r.score))}</Td>
              <Td><Pill tone={BAND_TONE[r.score_band as keyof typeof BAND_TONE] ?? "neutral"}>{SCORE_BAND_LABEL[r.score_band as keyof typeof SCORE_BAND_LABEL] ?? r.score_band}</Pill></Td>
              <Td className="tabular-nums">{r.first_response_median_minutes == null ? "—" : `${formatDuration(Number(r.first_response_median_minutes) / 60)} (${r.first_response_samples})`}</Td>
              <Td className="tabular-nums">{r.quote_fulfilment_rate == null ? "—" : `${Math.round(Number(r.quote_fulfilment_rate) * 100)}% (${r.quote_fulfilment_samples})`}</Td>
              <Td className="tabular-nums">{r.issuance_median_hours == null ? "—" : formatDuration(Number(r.issuance_median_hours))}</Td>
              <Td className="tabular-nums">{r.claims_samples ? `${r.claims_ack_median_hours == null ? "—" : formatDuration(Number(r.claims_ack_median_hours))} / ${r.claims_settle_median_days == null ? "—" : `${Number(r.claims_settle_median_days)} d`}` : "—"}</Td>
              <Td className="tabular-nums">{r.sla_measured ? `${Math.round((1 - r.sla_breached / r.sla_measured) * 100)}% (${r.sla_measured})` : "—"}</Td>
              <Td className="tabular-nums">{r.rating_count >= 3 && r.rating_avg != null ? `${Number(r.rating_avg).toFixed(1)} (${r.rating_count})` : `${r.rating_count}/3`}</Td>
              <Td className="tabular-nums">{r.requests_received}</Td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <Td colSpan={10} className="py-10 text-center text-muted">
                <p>No scorecards yet: the nightly scorecard-refresh job hasn&apos;t run.</p>
                {canRefresh ? (
                  <div className="mt-4 flex justify-center">
                    <ActionForm action={refreshScorecards} submitLabel="Run it now" inline />
                  </div>
                ) : (
                  <p className="mt-1 text-xs">A platform admin can run it now from this page.</p>
                )}
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
      <p className="text-xs text-subtle">Formulas and windows: docs/SCORECARDS_ANALYTICS.md. Components without enough history (5 measured; 3 reviews) are left out; a broker without a score is neutral in routing.</p>
    </div>
  );
}
