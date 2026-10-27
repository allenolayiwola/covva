import Link from "next/link";
import { ArrowRight, Briefcase, Car, HeartPulse, House, Plane, Umbrella } from "lucide-react";
import { buttonClass, cn } from "@im/ui";

/** The six hero categories (mockup 01). `line` is the marketing product line; /quote maps it to a catalogue category. */
export const HERO_CATEGORIES = [
  { line: "motor", label: "Motor", Icon: Car },
  { line: "home", label: "Home", Icon: House },
  { line: "health", label: "Health", Icon: HeartPulse },
  { line: "travel", label: "Travel", Icon: Plane },
  { line: "life-funeral", label: "Life", Icon: Umbrella },
  { line: "business", label: "Business", Icon: Briefcase },
] as const;

export interface HeroExample { label: string; monthly: number }

/**
 * The hero's cover picker: a short question, six category tiles (one row from `sm`, 3×2 on phones), the "Get quotes"
 * pill and the "A quote request is not cover" line. The two example prices are listed here on phones only; on
 * desktop the hero phone illustration shows them. A plain GET form, so it works before hydration and without JS:
 * the chosen category lands on /quote?category=… where the one-question-per-screen flow starts.
 */
export function HeroQuoteCard({ examples, defaultLine = "motor", className }: { examples: HeroExample[]; defaultLine?: string; className?: string }) {
  const titleId = "hero-quote-title";
  return (
    <form action="/quote" method="get" aria-labelledby={titleId} className={cn("w-full", className)}>
      <h2 id={titleId} className="text-[15px] font-semibold text-ink-2">What do you want to insure?</h2>

      <fieldset className="mt-3">
        <legend className="sr-only">Type of cover</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:gap-3">
          {HERO_CATEGORIES.map(({ line, label, Icon }) => (
            <label
              key={line}
              className={cn(
                "flex min-h-[76px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border border-line bg-white px-2 py-3 text-[14px] font-medium text-ink-2 shadow-card transition-colors",
                "hover:border-brand/50 hover:bg-mist has-[:checked]:border-brand has-[:checked]:bg-mint/60 has-[:checked]:text-brand-deep has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2",
              )}
            >
              <input type="radio" name="category" value={line} defaultChecked={line === defaultLine} className="sr-only" />
              <Icon aria-hidden className="size-5 text-brand" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className={buttonClass("primary", "lg", "mt-5 w-full sm:w-auto sm:min-w-[240px]")}>
        Get quotes <ArrowRight aria-hidden className="size-4" />
      </button>

      <ul className="mt-5 space-y-1.5 text-[14px] lg:hidden" aria-label="Example prices">
        {examples.slice(0, 2).map((e) => (
          <li key={e.label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted">{e.label.split(" · ")[0]}</span>
            <span className="font-semibold tabular-nums text-brand-deep">from GH₵ {e.monthly}/mo</span>
            <span className="rounded-full bg-amber-bg px-2 py-0.5 text-[13px] font-medium text-amber">Example · DEMO</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[13px] text-muted">
        <strong className="font-semibold text-ink-2">A quote request is not cover.</strong>{" "}
        <Link href="/how-it-works" className="font-medium text-brand underline-offset-2 hover:underline">How it works</Link>
      </p>
    </form>
  );
}
