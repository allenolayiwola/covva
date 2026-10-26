/**
 * Pure analytics helpers shared by the partner dashboards (web), the broker mobile
 * endpoints and the CSV exports. No I/O: every function takes plain rows.
 */

/** Share of `numerator` in `denominator` as a 0–1 ratio, or null when nothing was measured. */
export function conversionRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.min(1, Math.max(0, numerator / denominator));
}

export interface SlaItem {
  /** When the work was due. Null = no target, never measured. */
  dueAt: string | Date | null | undefined;
  /** When it was completed/responded. Null = still open. */
  completedAt?: string | Date | null;
  /** Explicit breach stamp (e.g. requests.sla_breached_at). */
  breachedAt?: string | Date | null;
}

export interface SlaStats {
  measured: number;
  onTime: number;
  late: number;
  openOverdue: number;
  /** 0–1, null when nothing has been measured yet. */
  rate: number | null;
}

const ms = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/**
 * On-time rate across SLA items. An item counts as measured once it is completed or its
 * deadline has passed; it is on time when completed by the deadline without a breach stamp.
 */
export function slaOnTimeRate(items: SlaItem[], now: number | Date = Date.now()): SlaStats {
  const nowMs = now instanceof Date ? now.getTime() : now;
  let measured = 0;
  let onTime = 0;
  let late = 0;
  let openOverdue = 0;
  for (const it of items) {
    const due = ms(it.dueAt);
    if (due == null) continue;
    const done = ms(it.completedAt);
    const breached = ms(it.breachedAt) != null;
    if (done != null) {
      measured++;
      if (!breached && done <= due) onTime++;
      else late++;
    } else if (due < nowMs) {
      measured++;
      openOverdue++;
    }
  }
  return { measured, onTime, late, openOverdue, rate: conversionRate(onTime, measured) };
}

export interface DayBucket<T = number> {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  value: T;
}

/** ISO calendar date of a timestamp (UTC). */
export function isoDay(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

/**
 * Groups rows by calendar day (UTC) between `from` and `to` inclusive, filling empty days with 0,
 * so charts always have a continuous axis. `value` defaults to counting rows.
 */
export function bucketByDay<T>(rows: T[], at: (row: T) => string | Date | null | undefined, from: string | Date, to: string | Date, value: (row: T) => number = () => 1): DayBucket[] {
  const start = new Date(isoDay(from));
  const end = new Date(isoDay(to));
  const totals = new Map<string, number>();
  for (const row of rows) {
    const t = at(row);
    if (t == null) continue;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) continue;
    const key = isoDay(d);
    totals.set(key, (totals.get(key) ?? 0) + value(row));
  }
  const out: DayBucket[] = [];
  for (let d = start.getTime(); d <= end.getTime(); d += 86_400_000) {
    const key = new Date(d).toISOString().slice(0, 10);
    out.push({ day: key, value: totals.get(key) ?? 0 });
  }
  return out;
}

export interface CommissionEntry {
  entry_type: string;
  amount: number | string;
  org_id: string;
  counterparty_org_id?: string | null;
  created_at?: string;
}

export interface CommissionStatement {
  status: string;
  commission: number | string;
  net_due?: number | string;
  period_start?: string;
  period_end?: string;
}

export interface CommissionSummary {
  /** Commission credited to the organisation (brokers) or payable by it (insurers). */
  earned: number;
  /** Commission on statements already marked paid. */
  paid: number;
  /** earned − paid, never negative. */
  outstanding: number;
  /** Revenue share / platform fees owed to Covva in the same entries. */
  platformDue: number;
  entries: number;
}

const num = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Broker commission summary from ledger entries and settlement statements.
 * `orgId` selects whose side of the entry counts: the broker is credited (`org_id`), the insurer
 * is debited (`counterparty_org_id`).
 */
export function commissionSummary(entries: CommissionEntry[], statements: CommissionStatement[], orgId?: string): CommissionSummary {
  let earned = 0;
  let platformDue = 0;
  let count = 0;
  for (const e of entries) {
    const mine = !orgId || e.org_id === orgId || e.counterparty_org_id === orgId;
    if (!mine) continue;
    if (e.entry_type === "broker_commission") {
      earned += Math.abs(num(e.amount));
      count++;
    } else if (e.entry_type === "revenue_share" || e.entry_type === "platform_fee") {
      platformDue += Math.abs(num(e.amount));
      count++;
    }
  }
  let paid = 0;
  for (const s of statements) if (s.status === "paid") paid += Math.abs(num(s.commission));
  return { earned: round2(earned), paid: round2(paid), outstanding: round2(Math.max(0, earned - paid)), platformDue: round2(platformDue), entries: count };
}

/** Sum of a numeric field over day buckets (used for KPI tiles above sparklines). */
export function sumBuckets(buckets: { value: number }[]): number {
  return buckets.reduce((s, b) => s + b.value, 0);
}

/** Percentage change between two totals; null when the previous period had nothing. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
