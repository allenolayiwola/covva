"use client";
import * as React from "react";
import { useActionState } from "react";
import { Star } from "lucide-react";
import { Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "./form-bits";
import { initialActionState, type ActionState } from "./utils";

export function JobReviewForm({ action, partnerName }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; partnerName: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [rating, setRating] = React.useState(0);
  const uid = React.useId();
  if (state.ok) return <FormMessage state={state} className="mt-2" />;
  return (
    <form action={formAction} className="mt-3 space-y-2 rounded-lg bg-mist/60 p-3" aria-label={`Rate ${partnerName}`}>
      <fieldset>
        <legend className="text-xs font-medium text-ink">How did {partnerName} do?</legend>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="rating" value={n} className="sr-only" checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} />
              <Star aria-hidden className={`size-6 ${n <= rating ? "fill-amber text-amber" : "text-subtle"}`} />
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${uid}-c`} className="sr-only">Comment (optional)</label>
      <Textarea id={`${uid}-c`} name="comment" rows={2} maxLength={1000} placeholder="Anything other customers should know? (optional)" className="min-h-14 text-sm" />
      <SubmitButton size="sm" disabled={!rating} pendingText="Saving…">Send rating</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
