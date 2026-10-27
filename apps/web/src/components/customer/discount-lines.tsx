import { Sparkles } from "lucide-react";
import { LOYALTY_DISCOUNT_NOTE, formatGHS } from "@im/core";
import { cn } from "@im/ui";

export interface DiscountLineView {
  id: string;
  label: string;
  explanation: string;
  pct: number | null;
  amount: number;
  capped: boolean;
  capNote?: string | null;
}

/** "What you saved and why": the explicit discount lines the engine recorded on a quote. Null when none. */
export function DiscountLines({ lines, premium, title = "What you saved and why", compact = false, className }: { lines: DiscountLineView[]; premium: number; title?: string; compact?: boolean; className?: string }) {
  if (!lines.length) return null;
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const net = Math.max(0, Math.round((premium - total) * 100) / 100);
  if (compact) {
    return (
      <p className={cn("flex items-center gap-1.5 text-[13px] font-medium text-brand-deep", className)}>
        <Sparkles aria-hidden className="size-3.5" /> Saves {formatGHS(total, { decimals: true })} · you pay {formatGHS(net, { decimals: true })}
      </p>
    );
  }
  return (
    <section aria-labelledby="saved-h" className={cn("rounded-card border border-brand/30 bg-mint/40 p-4", className)}>
      <h2 id="saved-h" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Sparkles aria-hidden className="size-4 text-brand" /> {title}
      </h2>
      <ul className="mt-3 divide-y divide-line/70">
        {lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {l.label}
                {l.pct !== null && <span className="ml-1 text-muted">· {l.pct}%</span>}
              </p>
              <p className="text-[13px] text-ink-2">{l.explanation}</p>
              {l.capped && l.capNote && <p className="text-[13px] text-muted">{l.capNote}</p>}
            </div>
            <span className="shrink-0 tabular-nums font-semibold text-brand-deep">−{formatGHS(l.amount, { decimals: true })}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-line/70 pt-3 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-muted">Insurer&apos;s premium</dt><dd className="tabular-nums text-ink">{formatGHS(premium, { decimals: true })}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">Discounts</dt><dd className="tabular-nums text-brand-deep">−{formatGHS(total, { decimals: true })}</dd></div>
        <div className="flex justify-between gap-4 font-semibold"><dt className="text-ink">Premium after discounts</dt><dd className="tabular-nums text-ink">{formatGHS(net, { decimals: true })}</dd></div>
      </dl>
      <p className="mt-3 text-[13px] text-muted">{LOYALTY_DISCOUNT_NOTE}</p>
    </section>
  );
}
