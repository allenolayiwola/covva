/**
 * Sponsor subscriptions: a sponsor abroad pays a relative's premium on a cadence.
 * Pure scheduling / presentation logic; collections live in apps/web/src/server/subscriptions.ts.
 * Every collection is a normal premium payment that settles to the insurer in GHS.
 */
export const SUBSCRIPTION_CADENCES = ["monthly", "quarterly", "annual"] as const;
export type SubscriptionCadence = (typeof SUBSCRIPTION_CADENCES)[number];

export const SUBSCRIPTION_STATUSES = ["active", "past_due", "paused", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: "ok" | "danger" | "wait" | "neutral"; hint: string }> = {
  active: { label: "Active", tone: "ok", hint: "The next premium will be collected automatically." },
  past_due: { label: "Past due", tone: "danger", hint: "The last collection failed. Update the card or retry; the insurer may lapse the cover after its grace period." },
  paused: { label: "Paused", tone: "wait", hint: "No collections until you resume. Cover may lapse if a premium falls due." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "No further collections. Existing cover runs to its end date." },
};

export const CADENCE_LABEL: Record<SubscriptionCadence, string> = { monthly: "Monthly", quarterly: "Every 3 months", annual: "Yearly" };

export function isCadence(v: unknown): v is SubscriptionCadence {
  return typeof v === "string" && (SUBSCRIPTION_CADENCES as readonly string[]).includes(v);
}

export function chargesPerYear(cadence: SubscriptionCadence): number {
  return cadence === "monthly" ? 12 : cadence === "quarterly" ? 4 : 1;
}

/** Amount per collection from an annual GHS premium (half up, 2 dp). */
export function instalmentAmount(annualGhs: number, cadence: SubscriptionCadence): number {
  if (!Number.isFinite(annualGhs) || annualGhs < 0) throw new RangeError("Amount must not be negative");
  return Math.floor((annualGhs / chargesPerYear(cadence)) * 100 + 0.5 + 1e-9) / 100;
}

/**
 * Next charge date: the same day-of-month one period later, clamped to the end of a shorter
 * month (31 Jan → 28 Feb → 28 Mar). Works in UTC so the schedule never drifts with DST.
 */
export function nextChargeDate(cadence: SubscriptionCadence, from: Date | string): Date {
  const d = typeof from === "string" ? new Date(from) : new Date(from.getTime());
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
  const months = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** Retry backoff after a failed collection: 1 day, 3 days, 7 days, then past due (stop retrying). */
export const RETRY_DAYS = [1, 3, 7] as const;

export function retrySchedule(failures: number): { retryInDays: number; pastDue: false } | { retryInDays: null; pastDue: true } {
  const n = Math.max(0, Math.floor(failures));
  if (n === 0) return { retryInDays: RETRY_DAYS[0], pastDue: false };
  const days = RETRY_DAYS[n - 1];
  return days === undefined ? { retryInDays: null, pastDue: true } : { retryInDays: days, pastDue: false };
}

/** When the insurer's grace period ends (cover may be lapsed by the insurer afterwards). */
export function graceEnd(pastDueSince: Date | string, graceDays: number): Date {
  const d = typeof pastDueSince === "string" ? new Date(pastDueSince) : pastDueSince;
  return new Date(d.getTime() + Math.max(0, graceDays) * 86_400_000);
}

export interface SubscriptionLike {
  cadence: SubscriptionCadence | string;
  status: SubscriptionStatus | string;
  display_currency: string;
  display_amount: number | string;
  ghs_amount: number | string;
  next_charge_at: string | null;
  last_charged_at?: string | null;
  failures?: number | null;
  past_due_since?: string | null;
}

export interface SubscriptionSummary {
  cadenceLabel: string;
  statusLabel: string;
  tone: "ok" | "danger" | "wait" | "neutral";
  hint: string;
  /** "≈ £61.25 monthly (GH₵ 1,255.63 to the insurer)" */
  amountLabel: string;
  nextChargeLabel: string;
  failures: number;
  /** Days until the next collection (negative when overdue); null when none is scheduled. */
  daysToNext: number | null;
}

/** Presentation for the account / admin lists. */
export function subscriptionSummary(s: SubscriptionLike, now = new Date()): SubscriptionSummary {
  const cadence = isCadence(s.cadence) ? s.cadence : "monthly";
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(s.status) ? (s.status as SubscriptionStatus) : "active";
  const meta = SUBSCRIPTION_STATUS[status];
  const ghs = Number(s.ghs_amount) || 0;
  const disp = Number(s.display_amount) || 0;
  const cur = s.display_currency.toUpperCase();
  const ghsText = `GH₵ ${ghs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amountLabel = cur === "GHS" ? `${ghsText} ${CADENCE_LABEL[cadence].toLowerCase()}` : `≈ ${cur} ${disp.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CADENCE_LABEL[cadence].toLowerCase()} (${ghsText} to the insurer)`;
  let nextChargeLabel = "No collection scheduled";
  let daysToNext: number | null = null;
  if (s.next_charge_at && (status === "active" || status === "past_due")) {
    const next = new Date(s.next_charge_at);
    daysToNext = Math.round((next.getTime() - now.getTime()) / 86_400_000);
    const date = next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    nextChargeLabel = daysToNext < 0 ? `Overdue since ${date}` : daysToNext === 0 ? `Due today (${date})` : `Next collection ${date}`;
  } else if (status === "paused") nextChargeLabel = "Paused";
  else if (status === "cancelled") nextChargeLabel = "Cancelled";
  return { cadenceLabel: CADENCE_LABEL[cadence], statusLabel: meta.label, tone: meta.tone, hint: meta.hint, amountLabel, nextChargeLabel, failures: Number(s.failures) || 0, daysToNext };
}
