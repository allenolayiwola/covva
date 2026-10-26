import { BadgeCheck } from "lucide-react";
import { Avatar, DemoBadge } from "@im/ui";
import { formatGHS } from "@im/core";
import { displayOrgName } from "./brand";
import { OrgTile } from "./org-tile";

export interface HeroInsurer { name: string; color: string | null }

/**
 * The illustrative composition from the home mockup, built in HTML/CSS:
 * a floating "Compare quotes" card, a teal active-policy card and a broker message.
 * All figures are illustrative; insurer names are fictional demo partners.
 */
export function HeroVisual({ insurers, demo }: { insurers: HeroInsurer[]; demo: boolean }) {
  const quotes = [
    { premium: 2400, excess: 1000 },
    { premium: 2650, excess: 750 },
    { premium: 2780, excess: 500 },
  ].map((q, i) => ({ ...q, insurer: insurers[i] ?? { name: ["Coastline General", "Volta Mutual", "Ashanti Shield"][i]!, color: null } }));
  const first = displayOrgName(quotes[0]!.insurer.name);

  return (
    <figure className="relative">
      <div
        aria-hidden
        className="relative flex flex-col gap-4 overflow-hidden rounded-[28px] bg-gradient-to-br from-mint-2 via-mist to-mint-2 p-4 pb-6 ring-1 ring-inset ring-line/60 sm:block sm:h-[520px] sm:p-0"
      >
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-white/60 blur-2xl" />

        {/* Compare quotes */}
        <div className="relative w-full rounded-[20px] border border-line/70 bg-white p-5 shadow-float motion-safe:animate-fade-up sm:absolute sm:left-6 sm:top-10 sm:w-[316px] sm:p-6">
          <p className="text-xs text-muted">Motor · 3 quotes</p>
          <p className="mt-0.5 text-[17px] font-semibold tracking-tight text-ink">Compare quotes</p>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {quotes.map((q) => (
              <li key={q.insurer.name} className="flex items-center gap-3 py-3">
                <OrgTile name={q.insurer.name} color={q.insurer.color} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{displayOrgName(q.insurer.name)}</p>
                  <p className="text-[11px] text-muted">Excess {formatGHS(q.excess)}</p>
                </div>
                <p className="text-[15px] font-semibold tabular-nums text-ink">{formatGHS(q.premium)}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex h-10 items-center justify-center rounded-[10px] bg-brand text-sm font-semibold text-white">Review all quotes</div>
        </div>

        {/* Active policy */}
        <div className="relative z-10 -mt-4 ml-auto w-[212px] overflow-hidden rounded-[20px] bg-brand-dark p-5 text-white shadow-float motion-safe:animate-fade-up [animation-delay:140ms] sm:absolute sm:right-4 sm:top-[236px] sm:mt-0">
          <div aria-hidden className="absolute -right-10 -top-12 size-32 rounded-full bg-white/[0.07]" />
          <p className="relative text-[11px] font-medium uppercase tracking-[0.14em] text-white/75">Motor · Active</p>
          <p className="relative mt-2 text-[17px] font-semibold tracking-tight">Your everyday drive</p>
          <p className="relative mt-0.5 truncate text-[11px] text-white/75">{first} · DEMO-1048</p>
          <p className="relative mt-5 text-[11px] text-white/70">Cover ends</p>
          <p className="relative text-[15px] font-semibold">30 Nov 2026</p>
        </div>

        {/* Broker message */}
        <div className="relative mr-auto flex w-full max-w-[310px] items-start gap-3 rounded-[18px] border border-line/70 bg-white p-4 shadow-float motion-safe:animate-fade-up [animation-delay:280ms] sm:absolute sm:bottom-10 sm:left-[14%]">
          <Avatar initials="KO" size={38} />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-semibold text-ink">
              Kofi, your broker
              <BadgeCheck className="size-3.5 text-brand" />
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">“Your quotes should be ready by tomorrow.”</p>
          </div>
        </div>

      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <span className="sr-only">
          Illustration: a comparison of three motor quotes, an active motor policy card and a message from a named broker.
        </span>
        {demo && <DemoBadge />}
      </figcaption>
    </figure>
  );
}
