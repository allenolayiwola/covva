/** Month helpers for usage & invoicing. `period` is YYYY-MM (UTC; Ghana is UTC+0). */
export function monthRange(period: string): { start: string; end: string; endExclusive: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const now = new Date();
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(y, mo, 1));
  const next = new Date(Date.UTC(y, mo + 1, 1));
  const end = new Date(next.getTime() - 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), endExclusive: iso(next) };
}

export interface InvoiceLine {
  code: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}
