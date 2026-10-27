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
 * The hero's cover picker (redesign variation A): heading, six category tiles in one row on desktop (3×2 on
 * phones), a "Get quotes" pill, the two "Example · DEMO" prices on one line each and the "A quote request is
 * not cover" disclaimer. A plain GET form, so it works before hydration and without JS: the chosen category
 * lands on /quote?category=… where the one-question-per-screen flow starts.
 */
export function HeroQuoteCard({ examples, defaultLine = "motor", className }: { examples: HeroExample[]; defaultLine?: string; className?: string }) {
  const titleId = "hero-quote-title";
  return (
    <form action="/quote" method="get" aria-labelledby={titleId} className={cn("w-full text-center", className)}>
      <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
        <h2 id={titleId} className="font-display text-[22px] leading-tight text-ink">What do you want to insure?</h2>
        <span className="whitespace-nowrap text-[13px] text-muted">Step 1 of 6</span>
      </div>

      <fieldset className="mt-5">
        <legend className="sr-only">Type of cover</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:gap-3">
          {HERO_CATEGORIES.map(({ line, label, Icon }) => (
            <label
              key={line}
              className={cn(
                "flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border border-line bg-white px-2 py-3 text-[14px] font-medium text-ink-2 shadow-card transition-colors lg:min-h-[96px] lg:text-[15px]",
                "hover:border-brand/50 hover:bg-mist has-[:checked]:border-brand has-[:checked]:bg-mint/60 has-[:checked]:text-brand-deep has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2",
              )}
            >
              <input type="radio" name="category" value={line} defaultChecked={line === defaultLine} className="sr-only" />
              <Icon aria-hidden className="size-5 text-brand lg:size-6" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className={buttonClass("primary", "lg", "mt-6 w-full sm:w-auto sm:min-w-[260px]")}>
        Get quotes <ArrowRight aria-hidden className="size-4" />
      </button>

      <ul className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-8" aria-label="Example prices">
        {examples.slice(0, 2).map((e) => (
          <li key={e.label} className="flex flex-col items-center gap-1 text-[14px] sm:flex-row sm:gap-2">
            <span className="text-muted">{e.label}</span>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span>
                <span className="font-semibold tabular-nums text-brand-deep">from GH₵ {e.monthly}</span>
                <span className="text-[13px] text-muted"> /month</span>
              </span>
              <span className="rounded-full bg-amber-bg px-2 py-0.5 text-[13px] font-medium text-amber">Example · DEMO</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mx-auto mt-4 max-w-[46rem] text-[13px] leading-relaxed text-muted">
        <strong className="font-semibold text-ink-2">A quote request is not cover.</strong> Quotes come from participating licensed insurers through the brokers you choose. Cover starts only when the insurer accepts and issues your policy.{" "}
        <Link href="/how-it-works" className="font-medium text-brand underline-offset-2 hover:underline">How it works</Link>
      </p>
    </form>
  );
}
