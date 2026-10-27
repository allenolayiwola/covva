"use client";
import * as React from "react";
import { useActionState } from "react";
import { Star } from "lucide-react";
import { Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "./form-bits";
import { initialActionState, type ActionState } from "./utils";

/** Star rating + optional short comment for the broker of record (1–5, up to 600 characters). */
export function BrokerRatingForm({ action, brokerName, what }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; brokerName: string; what: "request" | "claim" }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [rating, setRating] = React.useState(0);
  const uid = React.useId();
  if (state.ok) return <FormMessage state={state} className="mt-2" />;
  const words = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  return (
    <form action={formAction} className="space-y-3" aria-label={`Rate ${brokerName}`}>
      <fieldset>
        <legend className="text-sm font-medium text-ink">How did {brokerName} do on this {what}?</legend>
        <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="grid size-10 cursor-pointer place-items-center rounded-lg hover:bg-mist has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
              <input type="radio" name="rating" value={n} className="sr-only" checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} />
              <Star aria-hidden className={`size-7 ${n <= rating ? "fill-amber text-amber" : "text-subtle"}`} />
            </label>
          ))}
          <span className="ml-2 text-sm text-muted" aria-live="polite">{words[rating]}</span>
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${uid}-c`} className="text-sm text-muted">A few words for other customers (optional)</label>
        <Textarea id={`${uid}-c`} name="comment" rows={3} maxLength={600} placeholder="What went well, what could be better. Please don't include personal details." className="mt-1 min-h-20 text-sm" />
      </div>
      <p className="text-xs text-subtle">Reviews are checked by Covva before they are shown, and shown with your first name and initial only. Your broker can reply once.</p>
      <SubmitButton size="sm" disabled={!rating} pendingText="Saving…">Send rating</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
