import { Card } from "@im/ui";
import type { Supabase } from "@/app/(customer)/account/_lib/data";
import type { ActionState } from "@/components/customer/utils";
import { myBrokerReview, type ReviewSubjectType } from "@/server/scorecards";
import { Stars } from "@/components/score-summary";
import { BrokerRatingForm } from "./broker-rating-form";

/**
 * "Rate your broker" card on a completed request or settled claim (customer only). Reads the
 * caller's own review through RLS; once rated, shows the stars and the moderation state.
 */
export async function BrokerRatingPrompt({ supabase, subjectType, subjectId, brokerName, action }: { supabase: Supabase; subjectType: ReviewSubjectType; subjectId: string; brokerName: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const mine = await myBrokerReview(supabase, subjectType, subjectId);
  return (
    <Card className="p-5" as="section" aria-labelledby={`rate-${subjectId}`}>
      <h2 id={`rate-${subjectId}`} className="text-base font-semibold text-ink">Rate your broker</h2>
      {mine ? (
        <div className="mt-2 text-sm text-muted">
          <p className="flex items-center gap-2">
            You rated {brokerName} <Stars value={mine.rating} /> <span className="sr-only">{mine.rating} out of 5</span>
          </p>
          {mine.comment && <p className="mt-2 text-ink-2">“{mine.comment}”</p>}
          <p className="mt-2 text-xs text-subtle">
            {mine.status === "approved" ? "Published, shown with your first name and initial." : mine.status === "hidden" ? "Not shown publicly. Your rating still counts toward the broker's scorecard." : "Being checked by Covva before it is shown."}
          </p>
          {mine.reply && <p className="mt-2 rounded-lg bg-mist px-3 py-2 text-sm text-ink-2"><span className="font-medium text-ink">{brokerName} replied:</span> {mine.reply}</p>}
        </div>
      ) : (
        <div className="mt-3">
          <BrokerRatingForm action={action} brokerName={brokerName} what={subjectType} />
        </div>
      )}
    </Card>
  );
}
