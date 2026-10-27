/**
 * Motor telematics (roadmap Phase 4; Addendum 6 item 4): consented, phone-based driving score.
 *
 * The phone (mobile app) records TRIP SUMMARIES only — start/end time, distance, the highest speed band,
 * harsh braking / acceleration counts, the share of the trip driven at night and whether the phone was
 * handled while driving. No GPS trace is ever sent or stored. This module turns a month of trip summaries
 * into a 0–100 score with a factor breakdown; the weights live in TELEMATICS_SCORING (one place) and the
 * calculation is deterministic so a re-run always gives the same score.
 *
 * Consent comes first (consent type `telematics`), can be withdrawn at any time, and withdrawal stops
 * collection (database guard) — see docs/LOYALTY_TELEMATICS.md.
 */

export const SPEED_BANDS = ["under_50", "50_80", "80_100", "100_120", "over_120"] as const;
export type SpeedBand = (typeof SPEED_BANDS)[number];

export const SPEED_BAND_LABEL: Record<SpeedBand, string> = {
  under_50: "Under 50 km/h",
  "50_80": "50–80 km/h",
  "80_100": "80–100 km/h",
  "100_120": "100–120 km/h",
  over_120: "Over 120 km/h",
};

export const TELEMATICS_CONSENT_VERSION = "telematics-2026-10";

/** Scoring configuration — the single source of the weights and thresholds. */
export const TELEMATICS_SCORING = {
  version: 1,
  /** Factor weights (sum to 1). */
  weights: { speed: 0.35, harsh: 0.3, night: 0.2, phone: 0.15 },
  /** Penalty per speed band (0 = none, 1 = full), weighted by trip distance. */
  speedBandPenalty: { under_50: 0, "50_80": 0, "80_100": 0.3, "100_120": 0.7, over_120: 1 } as Record<SpeedBand, number>,
  /** Harsh events (brakes + accelerations) per 100 km at which the harsh factor reaches 0. */
  harshPer100kmFull: 8,
  /** Distance share driven at night at which the night factor reaches 0. */
  nightShareFull: 0.5,
  /** Share of trips with phone use at which the phone factor reaches 0. */
  phoneShareFull: 0.4,
  /** A month needs this much data before it gets a score. */
  minTrips: 5,
  minDistanceKm: 50,
  /** Months considered for the safe-driver discount. */
  lookbackMonths: 12,
} as const;

export type TelematicsFactor = keyof typeof TELEMATICS_SCORING.weights;

export const TELEMATICS_FACTOR_LABEL: Record<TelematicsFactor, string> = {
  speed: "Speed",
  harsh: "Smooth driving",
  night: "Daytime driving",
  phone: "Phone put away",
};

export interface TripSummary {
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  maxSpeedBand: SpeedBand;
  harshBrakeCount: number;
  harshAccelCount: number;
  /** 0–1: share of the trip's distance driven between 22:00 and 05:00. */
  nightShare: number;
  phoneUse: boolean;
}

export interface FactorScore {
  /** 0–100 (100 = best). */
  score: number;
  /** The measured input behind it ("2.1 harsh events per 100 km"). */
  detail: string;
}

export interface MonthlyScore {
  /** Null when there is not enough data for the month. */
  score: number | null;
  factors: Record<TelematicsFactor, FactorScore>;
  trips: number;
  distanceKm: number;
  sufficient: boolean;
  scoringVersion: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function isSpeedBand(v: unknown): v is SpeedBand {
  return typeof v === "string" && (SPEED_BANDS as readonly string[]).includes(v);
}

/** Scores one set of trips (normally a calendar month). Pure and deterministic. */
export function scoreTrips(trips: TripSummary[]): MonthlyScore {
  const cfg = TELEMATICS_SCORING;
  const valid = trips.filter((t) => Number.isFinite(t.distanceKm) && t.distanceKm > 0 && isSpeedBand(t.maxSpeedBand));
  const distance = round2(valid.reduce((s, t) => s + t.distanceKm, 0));
  const n = valid.length;
  const empty: FactorScore = { score: 100, detail: "No trips" };
  if (n === 0 || distance <= 0) {
    return { score: null, factors: { speed: empty, harsh: empty, night: empty, phone: empty }, trips: 0, distanceKm: 0, sufficient: false, scoringVersion: cfg.version };
  }
  // Speed: distance-weighted penalty of each trip's highest band.
  const speedPenalty = valid.reduce((s, t) => s + cfg.speedBandPenalty[t.maxSpeedBand] * t.distanceKm, 0) / distance;
  const fastKm = round1(valid.filter((t) => cfg.speedBandPenalty[t.maxSpeedBand] > 0).reduce((s, t) => s + t.distanceKm, 0));
  // Harsh events per 100 km.
  const events = valid.reduce((s, t) => s + Math.max(0, Math.round(t.harshBrakeCount)) + Math.max(0, Math.round(t.harshAccelCount)), 0);
  const per100 = (events / distance) * 100;
  // Night: distance-weighted share.
  const nightShare = valid.reduce((s, t) => s + clamp01(t.nightShare) * t.distanceKm, 0) / distance;
  // Phone: share of trips with handling.
  const phoneTrips = valid.filter((t) => t.phoneUse).length;
  const phoneShare = phoneTrips / n;

  const factors: Record<TelematicsFactor, FactorScore> = {
    speed: { score: Math.round(100 * (1 - clamp01(speedPenalty))), detail: fastKm > 0 ? `${fastKm} km of ${distance} km at 80 km/h or more` : "Never above 80 km/h" },
    harsh: { score: Math.round(100 * (1 - clamp01(per100 / cfg.harshPer100kmFull))), detail: `${round1(per100)} harsh events per 100 km` },
    night: { score: Math.round(100 * (1 - clamp01(nightShare / cfg.nightShareFull))), detail: `${Math.round(nightShare * 100)}% of distance between 22:00 and 05:00` },
    phone: { score: Math.round(100 * (1 - clamp01(phoneShare / cfg.phoneShareFull))), detail: `Phone handled on ${phoneTrips} of ${n} trips` },
  };
  const sufficient = n >= cfg.minTrips && distance >= cfg.minDistanceKm;
  const weighted = (Object.keys(cfg.weights) as TelematicsFactor[]).reduce((s, k) => s + cfg.weights[k] * factors[k].score, 0);
  return { score: sufficient ? Math.round(weighted) : null, factors, trips: n, distanceKm: distance, sufficient, scoringVersion: cfg.version };
}

/** First day of the month of `d` (UTC) as YYYY-MM-01. */
export function monthKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The month before the one containing `now`. */
export function previousMonthKey(now: Date = new Date()): string {
  return monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/** Trips whose start falls in the calendar month `period` (YYYY-MM-01). */
export function tripsInMonth<T extends { startedAt: string }>(trips: T[], period: string): T[] {
  return trips.filter((t) => monthKey(t.startedAt) === period);
}

export interface ScoredMonth {
  period: string;
  score: number | null;
  final: boolean;
}

export interface SafeDriverSummary {
  averageScore: number;
  monthsOfData: number;
  /** Months included (newest first). */
  periods: string[];
}

/**
 * The summary the loyalty engine's safe_driver rule reads: the mean of the FINAL monthly scores within the
 * look-back window (provisional current-month scores are ignored). Null when there is no scored month.
 */
export function safeDriverSummary(months: ScoredMonth[], now: Date = new Date(), lookback = TELEMATICS_SCORING.lookbackMonths): SafeDriverSummary | null {
  const floor = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lookback, 1)));
  const used = months.filter((m) => m.final && m.score !== null && m.period >= floor && m.period <= monthKey(now)).sort((a, b) => (a.period < b.period ? 1 : -1));
  if (!used.length) return null;
  const avg = Math.round(used.reduce((s, m) => s + (m.score ?? 0), 0) / used.length);
  return { averageScore: avg, monthsOfData: used.length, periods: used.map((m) => m.period) };
}

/** Plain-language band for a score (customer UI). */
export function drivingScoreBand(score: number | null): { label: string; tone: "ok" | "wait" | "danger" | "neutral" } {
  if (score === null) return { label: "Not enough trips yet", tone: "neutral" };
  if (score >= 85) return { label: "Very safe", tone: "ok" };
  if (score >= 70) return { label: "Safe", tone: "ok" };
  if (score >= 50) return { label: "Room to improve", tone: "wait" };
  return { label: "Risky", tone: "danger" };
}

/** Consent wording shown in-app before enrolment (plain language; reviewed with counsel before launch). */
export const TELEMATICS_CONSENT = {
  version: TELEMATICS_CONSENT_VERSION,
  title: "Share your driving score for a safer-driver discount",
  collected: [
    "When each trip starts and ends, and how far you drove.",
    "The highest speed band you reached on the trip (for example 80–100 km/h), not your exact speed.",
    "How many times you braked or accelerated harshly.",
    "What share of the trip was at night (22:00–05:00).",
    "Whether the phone was handled while the car was moving.",
  ],
  notCollected: ["Where you went: no GPS route or location is stored by Covva.", "Who you called or what you did on your phone."],
  use: "Your trips are turned into a monthly driving score (0–100). Your insurer sees the monthly score only, never the trips, and may give a safe-driver discount at renewal if your score meets its threshold.",
  retention: "Trip summaries are kept for 13 months so a year of scores can be calculated, then deleted. Monthly scores stay with the policy as the record of any discount.",
  withdrawal: "You can stop at any time from this page or the app. Collection stops immediately, trip summaries are deleted within the retention period, and any discount already given stays as it was.",
} as const;
