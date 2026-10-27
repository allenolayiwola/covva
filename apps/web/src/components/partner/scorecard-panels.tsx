import Link from "next/link";
import { COMPONENT_LABEL, RESPONSE_BAND_LABEL, SCORE_BAND_LABEL, formatDuration, maskReviewerName, type ScorecardComponent, type ScorecardWindow } from "@im/core";
import { Card, Pill, cn } from "@im/ui";
import { formatDate } from "@im/core";
import { Stars } from "@/components/score-summary";
import { ActionForm } from "@/components/partner/action-form";
import { Textarea } from "@im/ui";
import type { BrokerReview, ScorecardView } from "@/server/scorecards";
import type { FormAction } from "@/components/partner/action-form";

/** Scorecard panels shared by the broker's own page, the insurer's broker list and the admin console. */
export const BAND_TONE: Record<string, "ok" | "wait" | "danger" | "neutral"> = { excellent: "ok", good: "ok", fair: "wait", needs_attention: "danger", new: "neutral" };

export function ScoreHeadline({ card, window, className }: { card: ScorecardView | null; window: ScorecardWindow; className?: string }) {
  const score = card?.score == null ? null : Number(card.score);
  const band = card?.score_band ?? "new";
  return (
    <Card className={cn("p-5", className)}>
      <p className="text-sm text-muted">Score · last {window} days</p>
      <div className="mt-1 flex items-end gap-3">
        <p className="text-4xl font-bold tracking-tight text-ink tabular-nums">{score == null ? "—" : Math.round(score)}</p>
        <p className="pb-1 text-sm text-muted">out of 100</p>
        <Pill tone={BAND_TONE[band] ?? "neutral"} className="mb-1">{SCORE_BAND_LABEL[band as keyof typeof SCORE_BAND_LABEL] ?? band}</Pill>
      </div>
      <p className="mt-2 text-xs text-subtle">
        {card ? `Refreshed ${formatDate(card.computed_at)} · ${card.requests_received} requests received, ${card.requests_completed} completed` : "Not computed yet. The scorecard refreshes every night."}
      </p>
    </Card>
  );
}

export function ComponentBars({ components }: { components: ScorecardComponent[] }) {
  return (
    <ul className="space-y-3">
      {components.map((c) => (
        <li key={c.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-ink">{COMPONENT_LABEL[c.key] ?? c.label} <span className="text-xs font-normal text-subtle">· weight {c.weight}</span></span>
            <span className="tabular-nums text-ink">{c.points == null ? <span className="text-muted">not enough data</span> : `${Math.round(c.points)} / 100`}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-mist" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.points == null ? 0 : Math.round(c.points)} aria-label={`${c.label}: ${c.points == null ? "not enough data" : `${Math.round(c.points)} of 100`}`}>
            <div className={cn("h-full rounded-full", c.points == null ? "bg-line" : c.points >= 70 ? "bg-brand" : c.points >= 50 ? "bg-gold" : "bg-danger")} style={{ width: `${c.points == null ? 0 : Math.max(2, c.points)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">{c.display}{c.samples ? ` · ${c.samples} measured` : ""}</p>
        </li>
      ))}
    </ul>
  );
}

export function MeasuresTable({ card }: { card: ScorecardView }) {
  const rows: { label: string; value: string }[] = [
    { label: "First response (median)", value: card.first_response_median_minutes == null ? "—" : `${formatDuration(Number(card.first_response_median_minutes) / 60)} · ${card.first_response_samples} requests` },
    { label: "Response band shown to customers", value: card.first_response_median_minutes != null && card.first_response_samples >= 5 ? RESPONSE_BAND_LABEL[Number(card.first_response_median_minutes) <= 60 ? "within_hour" : Number(card.first_response_median_minutes) <= 480 ? "same_day" : Number(card.first_response_median_minutes) <= 1440 ? "next_day" : "slower"] : "Not shown yet (needs 5 measured requests)" },
    { label: "Requests reaching a binding quote", value: card.quote_fulfilment_rate == null ? "—" : `${Math.round(Number(card.quote_fulfilment_rate) * 100)} % of ${card.quote_fulfilment_samples}` },
    { label: "Time to a binding quote (median)", value: formatDuration(card.quote_median_hours == null ? null : Number(card.quote_median_hours)) },
    { label: "Payment to policy issued (median)", value: card.issuance_median_hours == null ? "—" : `${formatDuration(Number(card.issuance_median_hours))} · ${card.issuance_samples} policies` },
    { label: "Claims: time to acknowledge (median)", value: formatDuration(card.claims_ack_median_hours == null ? null : Number(card.claims_ack_median_hours)) },
    { label: "Claims: time to settle (median)", value: card.claims_settle_median_days == null ? "—" : `${Number(card.claims_settle_median_days)} days · ${card.claims_samples} claims` },
    { label: "Service levels missed", value: card.sla_measured ? `${card.sla_breached} of ${card.sla_measured} (${Math.round((card.sla_breached / card.sla_measured) * 100)} %)` : "—" },
    { label: "Customer rating (approved reviews in window)", value: card.rating_count >= 3 && card.rating_avg != null ? `${Number(card.rating_avg).toFixed(1)} / 5 from ${card.rating_count}` : `${card.rating_count} of 3 needed` },
  ];
  return (
    <dl className="divide-y divide-line text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start justify-between gap-4 py-2">
          <dt className="text-muted">{r.label}</dt>
          <dd className="text-right font-medium text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReviewList({ reviews, names, replyAction, canReply }: { reviews: BrokerReview[]; names: Map<string, { name: string | null; accountType: string | null }>; replyAction?: FormAction; canReply?: boolean }) {
  if (!reviews.length) return <p className="rounded-xl border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-muted">No approved reviews yet. Customers can rate you after a completed request or a settled claim.</p>;
  return (
    <ul className="divide-y divide-line">
      {reviews.map((r) => {
        const who = names.get(r.customer_id);
        return (
          <li key={r.id} className="py-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Stars value={r.rating} />
              <span className="sr-only">{r.rating} out of 5</span>
              <span className="font-medium text-ink">{maskReviewerName(who?.name, who?.accountType)}</span>
              <span className="text-subtle">· {formatDate(r.created_at)} · {r.subject_type === "claim" ? "after a claim" : "after a request"}</span>
            </div>
            {r.comment && <p className="mt-2 text-[15px] text-ink-2">{r.comment}</p>}
            {r.reply ? (
              <p className="mt-3 rounded-lg bg-mist px-3 py-2 text-sm text-ink-2"><span className="font-medium text-ink">Your reply</span> · {formatDate(r.replied_at)}: {r.reply}</p>
            ) : canReply && replyAction ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-brand">Reply once</summary>
                <ActionForm action={replyAction} submitLabel="Publish reply" pendingLabel="Publishing…" className="mt-2 max-w-xl">
                  <input type="hidden" name="reviewId" value={r.id} />
                  <Textarea name="reply" rows={3} maxLength={600} required placeholder="Thank the customer or explain what you have changed. Keep it short; do not name the customer." className="min-h-20 text-sm" />
                </ActionForm>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ExplainerLink({ className }: { className?: string }) {
  return (
    <Link href="/partners/how-we-score" target="_blank" className={cn("text-sm font-medium text-brand hover:underline", className)}>
      How the score is calculated
    </Link>
  );
}
