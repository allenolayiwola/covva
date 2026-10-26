import { formatGHS, type FeeBreakdown } from "@im/core";

/**
 * Fee transparency (Addendum 2 §G): what the customer pays and what the insurer pays out
 * of it. The platform fee and broker commission are never added to the customer's price.
 */
export function FeeBreakdownBlock({ breakdown, className }: { breakdown: FeeBreakdown | null | undefined; className?: string }) {
  if (!breakdown) return null;
  const rows: { label: string; value: number; note?: string }[] = [
    { label: "Premium", value: breakdown.premium },
    ...(breakdown.taxes > 0 ? [{ label: "Taxes and levies", value: breakdown.taxes }] : []),
    ...(breakdown.fees > 0 ? [{ label: "Insurer fees", value: breakdown.fees }] : []),
  ];
  return (
    <details className={className}>
      <summary className="cursor-pointer text-sm font-medium text-brand">How your price is made up</summary>
      <dl className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 px-4 py-2">
            <dt className="text-muted">{r.label}</dt>
            <dd className="font-medium text-ink">{formatGHS(r.value, { decimals: true })}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 px-4 py-2 font-semibold">
          <dt className="text-ink">You pay</dt>
          <dd className="text-ink">{formatGHS(breakdown.total, { decimals: true })}</dd>
        </div>
        {breakdown.platform_fee > 0 && (
          <div className="flex items-center justify-between gap-4 px-4 py-2 text-xs">
            <dt className="text-muted">Covva platform fee <span className="text-subtle">(paid by the insurer — included above)</span></dt>
            <dd className="text-muted">{formatGHS(breakdown.platform_fee, { decimals: true })}</dd>
          </div>
        )}
        {breakdown.broker_commission > 0 && (
          <div className="flex items-center justify-between gap-4 px-4 py-2 text-xs">
            <dt className="text-muted">Broker commission <span className="text-subtle">(paid by the insurer — included above)</span></dt>
            <dd className="text-muted">{formatGHS(breakdown.broker_commission, { decimals: true })}</dd>
          </div>
        )}
      </dl>
      {breakdown.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {breakdown.notes.map((n) => <li key={n}>• {n}</li>)}
        </ul>
      )}
    </details>
  );
}
