"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { Pill, cn } from "@im/ui";
import { DIASPORA_CURRENCIES, DIASPORA_EXAMPLES, DIASPORA_RATES_AS_OF, type DiasporaCurrency } from "./content";

function format(amountGhs: number, cur: DiasporaCurrency, period: "year" | "month") {
  const base = period === "month" ? amountGhs / 12 : amountGhs;
  const converted = base / cur.ghsPerUnit;
  const digits = cur.code === "GHS" ? 0 : converted < 20 ? 2 : 0;
  return `${cur.symbol}${converted.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * Diaspora currency switcher: shows indicative localised prices from a static rate table.
 * The final price in the payer's currency is always shown at checkout.
 */
export function CurrencySwitcher({ className }: { className?: string }) {
  const [code, setCode] = React.useState<DiasporaCurrency["code"]>("GBP");
  const [period, setPeriod] = React.useState<"year" | "month">("month");
  const cur = DIASPORA_CURRENCIES.find((c) => c.code === code) ?? DIASPORA_CURRENCIES[0]!;
  const groupId = React.useId();

  return (
    <div className={cn("rounded-[24px] border border-line bg-white p-5 shadow-float sm:p-7", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-labelledby={`${groupId}-cur`}>
          <p id={`${groupId}-cur`} className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Pay in</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DIASPORA_CURRENCIES.map((c) => (
              <button
                key={c.code}
                type="button"
                aria-pressed={c.code === code}
                onClick={() => setCode(c.code)}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                  c.code === code ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-2 hover:border-brand/50",
                )}
              >
                {c.code}
              </button>
            ))}
          </div>
        </div>
        <div role="group" aria-labelledby={`${groupId}-per`}>
          <p id={`${groupId}-per`} className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Show</p>
          <div className="mt-2 inline-flex rounded-full border border-line p-0.5">
            {(["month", "year"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={cn("h-8 rounded-full px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand", period === p ? "bg-mint text-brand-deep" : "text-muted")}
              >
                Per {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ul className="mt-6 divide-y divide-line" aria-live="polite">
        {DIASPORA_EXAMPLES.map((ex) => (
          <li key={ex.id} className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{ex.title}</p>
              <p className="text-[13px] text-muted">{ex.detail}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[20px] font-semibold tabular-nums text-ink">{format(ex.ghsPerYear, cur, period)}</p>
              <p className="text-[12px] text-muted">≈ {format(ex.ghsPerYear, DIASPORA_CURRENCIES[0]!, period)} · per {period}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-3 rounded-xl bg-mist p-4 text-[13px] leading-relaxed text-ink-2 sm:flex-row sm:items-start">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
        <p>
          <Pill tone="wait" className="mr-2">Indicative</Pill>
          Example premiums converted at a static rate ({cur.code === "GHS" ? "no conversion" : `1 ${cur.code} ≈ GH₵ ${cur.ghsPerUnit}`}, as of {DIASPORA_RATES_AS_OF}). The final price in your currency, including any card fees, is shown at checkout before you pay. The insurer receives cedis.
        </p>
      </div>
      <Link href="/get-started" className="mt-5 inline-flex items-center gap-1.5 rounded text-sm font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        Get a real quote for your family <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
