import { Star } from "lucide-react";
import { RESPONSE_BAND_LABEL, type ResponseBand, type ScoreBand } from "@im/core";
import { cn } from "@im/ui";

/**
 * Public broker score summary (broker picker, partner directory, request tracker). Shows only
 * what `broker_score_summary()` returns: an average from 3+ approved reviews, the number of
 * reviews and the response-time band. Never customer data. Safe in client and server components.
 */
export interface ScoreSummaryData {
  ratingAvg: number | null;
  reviewCount: number;
  responseBand: ResponseBand | null;
  scoreBand: ScoreBand;
}

export const EXPLAINER_HREF = "/partners/how-we-score";

export function Stars({ value, size = "size-4", className }: { value: number; size?: string; className?: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn(size, n <= Math.floor(rounded) ? "fill-amber text-amber" : n - 0.5 === rounded ? "fill-amber/50 text-amber" : "text-line")} />
      ))}
    </span>
  );
}

export function ScoreSummary({ summary, compact, explainer = true, className }: { summary: ScoreSummaryData | null | undefined; compact?: boolean; explainer?: boolean; className?: string }) {
  const s = summary ?? { ratingAvg: null, reviewCount: 0, responseBand: null, scoreBand: "new" as const };
  const hasRating = s.ratingAvg != null;
  const response = s.responseBand ? RESPONSE_BAND_LABEL[s.responseBand] : null;
  return (
    <div className={cn("text-[13px] text-muted", className)}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {hasRating ? (
          <>
            <Stars value={s.ratingAvg!} />
            <span className="font-semibold text-ink" aria-label={`Rated ${s.ratingAvg} out of 5`}>{s.ratingAvg!.toFixed(1)}</span>
            <span>{s.reviewCount} review{s.reviewCount === 1 ? "" : "s"}</span>
          </>
        ) : (
          <span>{s.reviewCount > 0 ? `${s.reviewCount} review${s.reviewCount === 1 ? "" : "s"} · rating shown from 3` : "New on Covva · no reviews yet"}</span>
        )}
        {!compact && response && <span className="before:mr-2 before:content-['·']">{response}</span>}
      </p>
      {compact && response && <p className="mt-0.5">{response}</p>}
      {explainer && (
        <a href={EXPLAINER_HREF} className="mt-0.5 inline-block font-medium text-brand underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
          How we calculate this
        </a>
      )}
    </div>
  );
}
