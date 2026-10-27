import { CircleCheck, Smartphone } from "lucide-react";
import { cn } from "@im/ui";
import { displayOrgName } from "./brand";
import { OrgTile } from "./org-tile";
import type { HeroInsurer } from "./hero-visual";

/**
 * Hero illustration (desktop only): a phone showing three example motor quotes, the recommended one
 * highlighted, and the MoMo pay button. Every figure is an example and the screen says so (DEMO pill);
 * insurer names are the demo partners from the directory. Decorative for screen readers, with a text
 * description in the figcaption.
 */
export function HeroPhone({ insurers, motorMonthly, healthMonthly }: { insurers: HeroInsurer[]; motorMonthly: number; healthMonthly: number }) {
  const quotes = [0, 7, 12].map((extra, i) => ({
    insurer: insurers[i] ?? { name: ["Coastline General", "Volta Mutual", "Ashanti Shield"][i]!, color: null },
    monthly: motorMonthly + extra,
    excess: [1000, 750, 500][i]!,
    best: i === 0,
  }));

  return (
    <figure className="relative mx-auto w-[340px]">
      <div aria-hidden className="absolute -inset-12 -z-10 rounded-full bg-mint/70 blur-3xl" />
      <div aria-hidden className="rounded-[44px] border-[10px] border-ink bg-white p-4 shadow-float">
        <div className="mx-auto mb-4 h-5 w-24 rounded-full bg-ink" />
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-[15px] font-semibold text-ink">Your motor quotes</p>
          <span className="rounded-full bg-amber-bg px-2 py-0.5 text-[12px] font-semibold text-amber">Example · DEMO</span>
        </div>
        <p className="px-1 text-[13px] text-muted">Private car · third party</p>
        <ul className="mt-3 space-y-2.5">
          {quotes.map((q) => (
            <li key={q.insurer.name} className={cn("rounded-2xl border p-3", q.best ? "border-brand bg-mint/50" : "border-line")}>
              <div className="flex items-center gap-3">
                <OrgTile name={q.insurer.name} color={q.insurer.color} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{displayOrgName(q.insurer.name)}</p>
                  <p className="text-[12px] text-muted">Excess GH₵ {q.excess.toLocaleString("en-GH")}</p>
                </div>
                <p className="text-right">
                  <span className="text-[17px] font-semibold tabular-nums text-ink">GH₵ {q.monthly}</span>
                  <span className="block text-[11px] text-muted">/month</span>
                </p>
              </div>
              {q.best && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[12px] font-semibold text-ink">
                  <CircleCheck className="size-3" /> Recommended
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-semibold text-white">
          <Smartphone className="size-4" /> Pay GH₵ {motorMonthly} with MoMo
        </div>
        <p className="mt-2 text-center text-[12px] text-muted">Health family plan from GH₵ {healthMonthly}/mo · example</p>
      </div>
      <figcaption className="sr-only">
        Example only: a phone showing three motor quotes from GH₵ {motorMonthly} a month, the recommended one highlighted, and a
        button to pay by MoMo. A family health plan is shown from GH₵ {healthMonthly} a month.
      </figcaption>
    </figure>
  );
}
