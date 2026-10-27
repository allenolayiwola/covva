import { test } from "node:test";
import assert from "node:assert/strict";
import { TELEMATICS_CONSENT, TELEMATICS_SCORING, monthKey, previousMonthKey, safeDriverSummary, scoreBand, scoreTrips, tripsInMonth, type TripSummary } from "./telematics.ts";

const trip = (over: Partial<TripSummary> = {}): TripSummary => ({
  startedAt: "2026-09-10T08:00:00Z",
  endedAt: "2026-09-10T08:30:00Z",
  distanceKm: 20,
  maxSpeedBand: "50_80",
  harshBrakeCount: 0,
  harshAccelCount: 0,
  nightShare: 0,
  phoneUse: false,
  ...over,
});

test("weights sum to one and the config is the only place they live", () => {
  const sum = Object.values(TELEMATICS_SCORING.weights).reduce((s, w) => s + w, 0);
  assert.equal(Math.round(sum * 1000) / 1000, 1);
  assert.equal(TELEMATICS_SCORING.version, 1);
});

test("a calm month scores 100; not enough data gives no score but still shows the factors", () => {
  const calm = scoreTrips(Array.from({ length: 6 }, () => trip()));
  assert.equal(calm.score, 100);
  assert.equal(calm.sufficient, true);
  assert.equal(calm.trips, 6);
  assert.equal(calm.distanceKm, 120);
  assert.equal(calm.factors.speed.detail, "Never above 80 km/h");

  const few = scoreTrips([trip(), trip()]);
  assert.equal(few.score, null);
  assert.equal(few.sufficient, false);
  assert.equal(few.factors.speed.score, 100);

  const empty = scoreTrips([]);
  assert.equal(empty.score, null);
  assert.equal(empty.trips, 0);
});

test("each factor responds to its input and the score is the weighted sum, deterministically", () => {
  const trips: TripSummary[] = [
    trip({ distanceKm: 50, maxSpeedBand: "over_120", harshBrakeCount: 2, harshAccelCount: 2, nightShare: 1, phoneUse: true }),
    trip({ distanceKm: 50, maxSpeedBand: "under_50" }),
    trip({ distanceKm: 50, maxSpeedBand: "under_50" }),
    trip({ distanceKm: 50, maxSpeedBand: "under_50" }),
    trip({ distanceKm: 50, maxSpeedBand: "under_50" }),
  ];
  const a = scoreTrips(trips);
  const b = scoreTrips([...trips].reverse());
  assert.deepEqual(a, b, "order of trips does not matter");
  // speed: 50 of 250 km at full penalty → 0.2 → 80
  assert.equal(a.factors.speed.score, 80);
  assert.equal(a.factors.speed.detail, "50 km of 250 km at 80 km/h or more");
  // harsh: 4 events / 250 km → 1.6 per 100 km → 1 - 1.6/8 = 0.8 → 80
  assert.equal(a.factors.harsh.score, 80);
  assert.equal(a.factors.harsh.detail, "1.6 harsh events per 100 km");
  // night: 50/250 = 0.2 → 1 - 0.2/0.5 = 0.6 → 60
  assert.equal(a.factors.night.score, 60);
  // phone: 1 of 5 trips → 0.2 → 1 - 0.2/0.4 = 0.5 → 50
  assert.equal(a.factors.phone.score, 50);
  assert.equal(a.factors.phone.detail, "Phone handled on 1 of 5 trips");
  assert.equal(a.score, Math.round(0.35 * 80 + 0.3 * 80 + 0.2 * 60 + 0.15 * 50));
  assert.equal(a.score, 72);
});

test("extreme behaviour bottoms out at 0 without going negative; bad rows are ignored", () => {
  const wild = scoreTrips(Array.from({ length: 10 }, () => trip({ distanceKm: 10, maxSpeedBand: "over_120", harshBrakeCount: 5, harshAccelCount: 5, nightShare: 1, phoneUse: true })));
  assert.equal(wild.score, 0);
  for (const f of Object.values(wild.factors)) assert.equal(f.score, 0);
  const mixed = scoreTrips([trip({ distanceKm: 0 }), trip({ distanceKm: -5 }), trip({ maxSpeedBand: "warp" as never }), trip()]);
  assert.equal(mixed.trips, 1);
});

test("month helpers", () => {
  assert.equal(monthKey("2026-09-30T23:59:59Z"), "2026-09-01");
  assert.equal(monthKey(new Date("2026-01-15T00:00:00Z")), "2026-01-01");
  assert.equal(previousMonthKey(new Date("2026-01-15T00:00:00Z")), "2025-12-01");
  const all = [trip({ startedAt: "2026-08-31T23:00:00Z" }), trip({ startedAt: "2026-09-01T00:00:00Z" }), trip({ startedAt: "2026-09-20T10:00:00Z" })];
  assert.equal(tripsInMonth(all, "2026-09-01").length, 2);
});

test("safe-driver summary averages FINAL months in the look-back window only", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const months = [
    { period: "2026-10-01", score: 99, final: false }, // provisional current month: ignored
    { period: "2026-09-01", score: 80, final: true },
    { period: "2026-08-01", score: 90, final: true },
    { period: "2026-07-01", score: null, final: true }, // not enough trips: ignored
    { period: "2025-09-01", score: 10, final: true }, // outside 12 months
  ];
  const s = safeDriverSummary(months, now);
  assert.deepEqual(s, { averageScore: 85, monthsOfData: 2, periods: ["2026-09-01", "2026-08-01"] });
  assert.equal(safeDriverSummary([{ period: "2026-10-01", score: 99, final: false }], now), null);
  assert.equal(safeDriverSummary([], now), null);
});

test("score bands and consent wording are plain and complete", () => {
  assert.equal(scoreBand(null).label, "Not enough trips yet");
  assert.equal(scoreBand(90).tone, "ok");
  assert.equal(scoreBand(55).tone, "wait");
  assert.equal(scoreBand(20).tone, "danger");
  assert.ok(TELEMATICS_CONSENT.collected.length >= 5);
  assert.ok(TELEMATICS_CONSENT.notCollected.some((t) => /GPS/.test(t)));
  assert.match(TELEMATICS_CONSENT.withdrawal, /any time/);
  assert.match(TELEMATICS_CONSENT.retention, /13 months/);
});
