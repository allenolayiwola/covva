import { formatGHS } from "@im/core";
import type { Row } from "@im/db";

type Line = Pick<Row<"quote_discounts">, "id" | "label" | "explanation" | "pct" | "amount" | "capped" | "cap_note" | "rule_set_version">;

/**
 * The insurer's discount lines under a quote's premium (broker and insurer views). Same lines the customer
 * sees as "What you saved and why"; the base premium is untouched.
 */
export function QuoteDiscountSummary({ lines, premium }: { lines: Line[]; premium: number }) {
  if (!lines.length) return null;
  const total = Math.round(lines.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
  return (
    <details className="mt-1 text-xs font-normal">
      <summary className="cursor-pointer text-brand-deep">
        −{formatGHS(total, { decimals: true })} discounts · net {formatGHS(Math.max(0, premium - total), { decimals: true })}
      </summary>
      <ul className="mt-1 space-y-1 text-muted">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="font-medium text-ink">{l.label}</span>
            {l.pct !== null ? ` · ${Number(l.pct)}%` : ""} · −{formatGHS(Number(l.amount), { decimals: true })}
            <span className="block">{l.explanation}{l.capped && l.cap_note ? ` ${l.cap_note}.` : ""}</span>
          </li>
        ))}
        <li className="text-subtle">Insurer rules v{lines[0]!.rule_set_version ?? "?"}. Discounts are the insurer&apos;s; the premium above is unchanged.</li>
      </ul>
    </details>
  );
}
