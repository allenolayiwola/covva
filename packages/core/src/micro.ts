/**
 * Micro and on-demand cover (Addendum 6 item 1): daily, weekly and monthly low-cost policies for
 * okada / trotro / ride-hailing drivers, market traders, artisans and event organisers, bought and
 * renewed in a few taps by mobile money, WhatsApp or USSD. Pure helpers; purchase and renewal live
 * in apps/web/src/server/micro.ts.
 */
import { addMonthsUtc } from "./instalments";
import { isPolicyPeriod, type PolicyPeriod } from "./rating";

export const AUDIENCE_TAGS = ["okada", "trotro", "ride_hailing", "trader", "artisan", "event"] as const;
export type AudienceTag = (typeof AUDIENCE_TAGS)[number];

export const AUDIENCE_LABEL: Record<AudienceTag, string> = {
  okada: "Okada riders",
  trotro: "Trotro drivers and mates",
  ride_hailing: "Ride-hailing drivers",
  trader: "Market traders",
  artisan: "Artisans",
  event: "Event organisers",
};

/** Periods micro cover is sold for (short, pay as you go). */
export const MICRO_PERIODS = ["day", "week", "month"] as const satisfies readonly PolicyPeriod[];
export type MicroCoverPeriod = (typeof MICRO_PERIODS)[number];

export const PERIOD_LABEL: Record<PolicyPeriod, { noun: string; per: string; adverb: string }> = {
  day: { noun: "day", per: "/day", adverb: "daily" },
  week: { noun: "week", per: "/week", adverb: "weekly" },
  month: { noun: "month", per: "/month", adverb: "monthly" },
  quarter: { noun: "3 months", per: "/quarter", adverb: "quarterly" },
  year: { noun: "year", per: "/year", adverb: "yearly" },
};

export function isAudienceTag(v: unknown): v is AudienceTag {
  return typeof v === "string" && (AUDIENCE_TAGS as readonly string[]).includes(v);
}

export function isMicroPeriod(v: unknown): v is MicroCoverPeriod {
  return typeof v === "string" && (MICRO_PERIODS as readonly string[]).includes(v);
}

const DAY = 86_400_000;

/** The cover window for a period starting at `start` (UTC): a day is 24 hours, a month is one calendar month. */
export function coverWindow(period: PolicyPeriod, start: Date | string = new Date()): { startsAt: string; endsAt: string } {
  const s = typeof start === "string" ? new Date(start) : new Date(start.getTime());
  if (Number.isNaN(s.getTime())) throw new RangeError("Invalid start");
  let e: Date;
  switch (period) {
    case "day": e = new Date(s.getTime() + DAY); break;
    case "week": e = new Date(s.getTime() + 7 * DAY); break;
    case "month": e = addMonthsUtc(s, 1); break;
    case "quarter": e = addMonthsUtc(s, 3); break;
    case "year": e = addMonthsUtc(s, 12); break;
  }
  return { startsAt: s.toISOString(), endsAt: e.toISOString() };
}

/** A renewal starts when the current window ends (no gap), or now if it already ended. */
export function renewalStart(currentEndsAt: string | null | undefined, now: Date = new Date()): Date {
  const end = currentEndsAt ? Date.parse(currentEndsAt) : NaN;
  return Number.isNaN(end) || end < now.getTime() ? now : new Date(end);
}

/** Auto-renew lead time: charge / send a pay link this long before the window ends. */
export const AUTO_RENEW_LEAD_HOURS: Record<PolicyPeriod, number> = { day: 3, week: 12, month: 24, quarter: 48, year: 72 };

export function autoRenewDue(period: PolicyPeriod, endsAt: string, now: Date = new Date()): boolean {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return false;
  return end - now.getTime() <= AUTO_RENEW_LEAD_HOURS[period] * 3_600_000 && end > now.getTime() - DAY;
}

export interface MicroProductLike {
  versionId: string;
  productName: string;
  insurerName: string;
  categorySlug?: string | null;
  micro: boolean;
  audienceTags: readonly string[];
  periods: readonly string[];
  /** Premium per period (from `ratePremium(...).byPeriod`). */
  byPeriod: Partial<Record<PolicyPeriod, number>>;
  summary?: string | null;
}

export interface MicroProductCard extends MicroProductLike {
  /** Cheapest supported micro period, e.g. { period: "day", amount: 2.5 }. */
  from: { period: MicroCoverPeriod; amount: number } | null;
  /** "from GH₵ 2.50/day" */
  fromLabel: string | null;
  audiences: { tag: AudienceTag; label: string }[];
}

const money = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Published micro versions for an audience (all audiences when null), cheapest daily price first. */
export function microProducts(products: readonly MicroProductLike[], audience?: string | null): MicroProductCard[] {
  const tag = isAudienceTag(audience) ? audience : null;
  return products
    .filter((p) => p.micro && (!tag || p.audienceTags.includes(tag)))
    .map((p) => {
      const periods = MICRO_PERIODS.filter((x) => p.periods.includes(x) && (p.byPeriod[x] ?? 0) > 0);
      const first = periods[0];
      const from = first ? { period: first, amount: p.byPeriod[first]! } : null;
      return {
        ...p,
        from,
        fromLabel: from ? `from ${money(from.amount)}${PERIOD_LABEL[from.period].per}` : null,
        audiences: p.audienceTags.filter(isAudienceTag).map((t) => ({ tag: t, label: AUDIENCE_LABEL[t] })),
      };
    })
    .filter((p) => p.from !== null)
    .sort((a, b) => {
      const order = (c: MicroProductCard) => MICRO_PERIODS.indexOf(c.from!.period);
      return order(a) - order(b) || a.from!.amount - b.from!.amount || a.productName.localeCompare(b.productName);
    });
}

/** Periods a version can be bought for, in a stable order. */
export function supportedPeriods(periods: readonly string[] | null | undefined): PolicyPeriod[] {
  const set = new Set((periods ?? []).filter(isPolicyPeriod));
  return (["day", "week", "month", "quarter", "year"] as const).filter((p) => set.has(p));
}

/** Max length of an SMS / USSD screen line we send. */
export const SMS_MAX = 160;

/**
 * Short quote for SMS / USSD (≤ 160 characters, GSM-safe ASCII apart from "GHS"):
 * "Okada Day Cover by Coastline: GHS 2.50 for 1 day. Reply 1 to pay by MoMo. Covva is a tech platform; cover is from the insurer."
 */
export function microQuoteText(q: { productName: string; insurerName: string; period: PolicyPeriod; amount: number; action?: string | null }): string {
  const amount = `GHS ${q.amount.toFixed(2)}`;
  const period = q.period === "quarter" ? "3 months" : `1 ${PERIOD_LABEL[q.period].noun}`;
  const action = q.action ?? "Reply 1 to pay by MoMo.";
  const tail = ` ${amount} for ${period}. ${action}`;
  const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  let head = `${clean(q.productName)} by ${clean(q.insurerName)}:`;
  const disclaimer = " Cover is from the insurer.";
  let text = head + tail + disclaimer;
  if (text.length > SMS_MAX) text = head + tail;
  if (text.length > SMS_MAX) {
    const room = SMS_MAX - tail.length - 1;
    head = `${head.slice(0, Math.max(8, room - 1)).trimEnd()}:`;
    text = head + tail;
  }
  return text.length > SMS_MAX ? text.slice(0, SMS_MAX) : text;
}
