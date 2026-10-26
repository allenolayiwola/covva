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
 * Framed quote card in the hero: a 6-category picker, a "Get quotes" pill, two "Example · DEMO" prices and the
 * "A quote request is not cover" disclaimer. A plain GET form, so it works before hydration and without JS:
 * the chosen category lands on /quote?category=… where the one-question-per-screen flow starts.
 */
export function HeroQuoteCard({ examples, defaultLine = "motor", className, slot = "desktop" }: { examples: HeroExample[]; defaultLine?: string; className?: string; slot?: "desktop" | "mobile" }) {
  const titleId = `hero-quote-title-${slot}`;
  return (
    <form action="/quote" method="get" aria-labelledby={titleId} className={cn("rounded-hero border border-line bg-white p-5 shadow-float sm:p-6", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="font-display text-[22px] leading-tight text-ink">What do you want to insure?</h2>
        <span className="text-[13px] text-muted">Step 1 of 6</span>
      </div>

      <fieldset className="mt-4">
        <legend className="sr-only">Type of cover</legend>
        <div className="grid grid-cols-3 gap-2">
          {HERO_CATEGORIES.map(({ line, label, Icon }) => (
            <label
              key={line}
              className={cn(
                "group flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border border-line bg-white px-2 py-3 text-center text-[14px] font-medium text-ink-2 transition-colors",
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

      <button type="submit" className={buttonClass("primary", "lg", "mt-4 w-full")}>
        Get quotes <ArrowRight aria-hidden className="size-4" />
      </button>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Example prices">
        {examples.slice(0, 2).map((e) => (
          <li key={e.label} className="rounded-field border border-line bg-mist px-3 py-2.5">
            <p className="text-[13px] text-muted">{e.label}</p>
            <p className="mt-0.5 flex items-baseline gap-1.5 text-ink">
              <span className="text-[17px] font-semibold tabular-nums text-brand-deep">from GH₵ {e.monthly}</span>
              <span className="text-[13px] text-muted">/month</span>
              <span className="ml-auto rounded-full bg-amber-bg px-2 py-0.5 text-[13px] font-medium text-amber">Example · DEMO</span>
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        <strong className="font-semibold text-ink-2">A quote request is not cover.</strong> Quotes come from participating licensed insurers through the brokers you choose. Cover starts only when the insurer accepts and issues your policy.{" "}
        <Link href="/how-it-works" className="font-medium text-brand underline-offset-2 hover:underline">How it works</Link>
      </p>
    </form>
  );
}
