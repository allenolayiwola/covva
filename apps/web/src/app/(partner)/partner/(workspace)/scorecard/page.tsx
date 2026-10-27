import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DemoBadge, PageHeader, Pill, Table, Tabs, Td, Th, THead } from "@im/ui";
import { SCORECARD_WINDOWS, SCORE_BAND_LABEL, formatDuration, type ScorecardWindow } from "@im/core";
import { can, getPartnerContext, ROLES, type PartnerContext } from "../../_lib/context";
import { Empty, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { BAND_TONE, ComponentBars, ExplainerLink, MeasuresTable, ReviewList, ScoreHeadline } from "@/components/partner/scorecard-panels";
import { brokerOwnReviews, loadScorecards, loadScorecardsForInsurer } from "@/server/scorecards";
import { replyToBrokerReview } from "./actions";

export const metadata: Metadata = { title: "Scorecard" };

export default function ScorecardPage({ searchParams }: PageProps<"/partner/scorecard">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={3} /></>}>
      <Scorecard searchParams={searchParams} />
    </Suspense>
  );
}

async function Scorecard({ searchParams }: Pick<PageProps<"/partner/scorecard">, "searchParams">) {
  const [ctx, sp] = await Promise.all([getPartnerContext(), searchParams]);
  if (ctx.kind === "distributor") redirect("/partner");
  const window: ScorecardWindow = Number(sp.window) === 30 ? 30 : 90;
  return ctx.kind === "insurer" ? <InsurerView ctx={ctx} /> : <BrokerView ctx={ctx} window={window} />;
}

// ---------------------------------------------------------------------------
// Broker: own scorecard, trends, what would move it, reviews with replies
// ---------------------------------------------------------------------------
async function BrokerView({ ctx, window }: { ctx: PartnerContext; window: ScorecardWindow }) {
  const [cards, reviews] = await Promise.all([loadScorecards(ctx.supabase, ctx.orgId), brokerOwnReviews(ctx.supabase, ctx.orgId)]);
  const card = cards[window] ?? null;
  const other = cards[window === 90 ? 30 : 90] ?? null;
  const names = new Map<string, { name: string | null; accountType: string | null }>(); // reviewers stay anonymous to the broker
  const canReply = can(ctx, ROLES.brokerWork);
  const trend = card?.score != null && other?.score != null ? Number((window === 30 ? card.score : other.score)) - Number(window === 30 ? other.score : card.score) : null;

  return (
    <>
      <PageHeader
        title="Your scorecard"
        description="How customers experience your service: first response, quote fulfilment, issuance, claims support, service levels and ratings. The 90-day score also nudges your position in the broker pool, within a bounded weight."
        actions={<ExplainerLink />}
      />
      <Tabs active={String(window)} items={SCORECARD_WINDOWS.map((w) => ({ key: String(w), label: `Last ${w} days`, href: `/partner/scorecard?window=${w}` }))} className="mb-6 w-fit" />

      <div className="grid gap-4 md:grid-cols-3">
        <ScoreHeadline card={card} window={window} />
        <div className="rounded-card border border-line bg-white p-5">
          <p className="text-sm text-muted">Trend · 30 vs 90 days</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink tabular-nums">{trend == null ? "—" : `${trend > 0 ? "▲" : trend < 0 ? "▼" : "•"} ${Math.abs(Math.round(trend))} pts`}</p>
          <p className="mt-2 text-xs text-subtle">{trend == null ? "Needs a score in both windows." : trend > 0 ? "Recent weeks are better than your 90-day average." : trend < 0 ? "Recent weeks are below your 90-day average." : "Steady."}</p>
        </div>
        <div className="rounded-card border border-line bg-white p-5">
          <p className="text-sm text-muted">Shown to customers</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{card?.rating_count != null && card.rating_count >= 3 && card.rating_avg != null ? `${Number(card.rating_avg).toFixed(1)} / 5` : "No rating yet"}</p>
          <p className="mt-2 text-xs text-subtle">{card ? `${card.rating_count} approved review${card.rating_count === 1 ? "" : "s"} in the window · rating shown from 3` : "—"}{card?.first_response_median_minutes != null && card.first_response_samples >= 5 ? ` · first response ${formatDuration(Number(card.first_response_median_minutes) / 60)}` : ""}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Section title="What makes up the score" description="Each component scores 0–100 and carries a weight. Components without enough history are left out and their weight is shared by the rest.">
          {card ? <ComponentBars components={card.components} /> : <Empty>Your scorecard has not been computed yet. It refreshes every night from your requests, quotes, policies, claims and reviews.</Empty>}
        </Section>
        <div className="space-y-6">
          <Section title="What would move it" description="Biggest gains first.">
            {card?.suggestions.length ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
                {card.suggestions.map((s) => (
                  <li key={s.key}>{s.text}{s.upside > 0 && <span className="text-subtle"> (up to +{Math.round(s.upside)} pts)</span>}</li>
                ))}
              </ol>
            ) : (
              <Empty>Nothing to suggest yet.</Empty>
            )}
          </Section>
          {card && (
            <Section title="The measures">
              <MeasuresTable card={card} />
            </Section>
          )}
        </div>
      </div>

      <Section title="Customer reviews" description="Approved reviews are shown publicly with the customer's first name and initial. You can reply once to each; replies are public." className="mt-6">
        <ReviewList reviews={reviews} names={names} replyAction={replyToBrokerReview} canReply={canReply} />
      </Section>
      {ctx.isDemo && <DemoBadge className="mt-4" text="Demo organisation · scores reflect demo data" />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Insurer: scorecards of appointed brokers (90 days), no customer data
// ---------------------------------------------------------------------------
async function InsurerView({ ctx }: { ctx: PartnerContext }) {
  const rows = await loadScorecardsForInsurer(ctx.supabase, ctx.orgId);
  return (
    <>
      <PageHeader title="Broker scorecards" description="Service scores of the brokers appointed to you, over the last 90 days. The same measures customers see, with no customer data." actions={<ExplainerLink />} />
      {rows.length === 0 ? (
        <Empty>No brokers hold an active appointment with you yet.</Empty>
      ) : (
        <Table>
          <THead><tr><Th>Broker</Th><Th>Score</Th><Th>First response</Th><Th>Quoted</Th><Th>Service levels</Th><Th>Rating</Th></tr></THead>
          <tbody>
            {rows.map((r) => {
              const c = r.scorecard;
              return (
                <tr key={r.brokerOrgId}>
                  <Td className="font-semibold text-ink">{r.brokerName}</Td>
                  <Td>
                    {c?.score != null ? <span className="font-semibold tabular-nums text-ink">{Math.round(Number(c.score))}</span> : <span className="text-muted">—</span>}{" "}
                    <Pill tone={BAND_TONE[c?.score_band ?? "new"] ?? "neutral"}>{SCORE_BAND_LABEL[(c?.score_band ?? "new") as keyof typeof SCORE_BAND_LABEL]}</Pill>
                  </Td>
                  <Td>{c?.first_response_median_minutes == null ? "—" : formatDuration(Number(c.first_response_median_minutes) / 60)}</Td>
                  <Td>{c?.quote_fulfilment_rate == null ? "—" : `${Math.round(Number(c.quote_fulfilment_rate) * 100)} %`}</Td>
                  <Td>{c?.sla_measured ? `${Math.round((1 - c.sla_breached / c.sla_measured) * 100)} % on time` : "—"}</Td>
                  <Td>{c && c.rating_count >= 3 && c.rating_avg != null ? `${Number(c.rating_avg).toFixed(1)} / 5 (${c.rating_count})` : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="mt-4 text-xs text-subtle">Scores refresh nightly. Components without enough history are left out; a new broker has no score and is treated as neutral in routing.</p>
    </>
  );
}
