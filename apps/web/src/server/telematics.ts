import "server-only";
import { TELEMATICS_CONSENT, TELEMATICS_SCORING, monthKey, previousMonthKey, safeDriverSummary, scoreTrips, tripsInMonth, type MonthlyScore, type SpeedBand, type TelematicsTripsInput, type TripSummary } from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { dbError, type UserClient } from "@/server/api-auth";
import { log } from "@/server/log";

/**
 * Motor telematics (Phase 4): consented phone-based driving score.
 *
 *   telematicsOverview()  the customer's motor policies, enrolments, monthly scores, a provisional score for the
 *                         current month (computed from trips with the pure scorer) and the consent state
 *   ingestTrips()         POST /api/v1/me/telematics/trips — idempotent batch upload after enrolment + consent checks
 *   telematicsScoring     monthly cron: final score for last month, provisional for this month (upsert = idempotent)
 *
 * Trips are summaries only (no GPS trace). The insurer reads monthly scores, never trips (RLS).
 */
type Svc = ReturnType<typeof createServiceClient>;
type AnyClient = Svc | UserClient;

const toTrip = (t: Row<"telematics_trips">): TripSummary => ({
  startedAt: t.started_at,
  endedAt: t.ended_at,
  distanceKm: Number(t.distance_km),
  maxSpeedBand: t.max_speed_band as SpeedBand,
  harshBrakeCount: t.harsh_brake_count,
  harshAccelCount: t.harsh_accel_count,
  nightShare: Number(t.night_share),
  phoneUse: t.phone_use,
});

export interface TelematicsOverview {
  consent: { granted: boolean; version: string | null; at: string | null; wording: typeof TELEMATICS_CONSENT };
  policies: { id: string; policyNumber: string | null; label: string; insurerName: string; status: string; coverEnd: string | null; enrolment: { id: string; status: string; enrolledAt: string; withdrawnAt: string | null; deviceLabel: string | null; monthsOfData: number } | null }[];
  enrolments: {
    id: string;
    policyId: string;
    status: string;
    enrolledAt: string;
    withdrawnAt: string | null;
    monthsOfData: number;
    current: { period: string } & MonthlyScore;
    months: { period: string; score: number | null; final: boolean; trips: number; distanceKm: number; factors: Json }[];
    summary: { averageScore: number; monthsOfData: number } | null;
    trips: { last30Days: number; distanceKm30Days: number; total: number; lastTripAt: string | null };
  }[];
  scoring: { version: number; weights: typeof TELEMATICS_SCORING.weights; minTrips: number; minDistanceKm: number; lookbackMonths: number };
}

/** Everything the customer page and GET /api/v1/me/telematics show (RLS-scoped). */
export async function telematicsOverview(db: UserClient, userId: string, now = new Date()): Promise<TelematicsOverview> {
  const [{ data: consent }, { data: policies }, { data: enrolments }] = await Promise.all([
    db.from("consents").select("granted, version, created_at").eq("user_id", userId).eq("type", "telematics").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db
      .from("policies")
      .select("id, policy_number, internal_reference, status, cover_end, nickname, summary, external_source, insured_items, category:product_categories!policies_category_id_fkey(slug, name), insurer:organizations!policies_insurer_org_id_fkey(name)")
      .eq("customer_id", userId)
      .in("status", ["pending_issuance", "active"])
      .eq("external_source", false)
      .order("cover_end", { ascending: true })
      .limit(50),
    db.from("telematics_enrolments").select("*").eq("user_id", userId).order("enrolled_at", { ascending: false }).limit(20),
  ]);
  const motor = (policies ?? []).filter((p) => (p.category as unknown as { slug?: string } | null)?.slug === "motor");
  const list = enrolments ?? [];
  const activeByPolicy = new Map(list.filter((e) => e.status === "active").map((e) => [e.policy_id, e]));
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [{ data: scores }, { data: trips }] = await Promise.all([
    list.length ? db.from("telematics_scores").select("*").in("enrolment_id", list.map((e) => e.id)).order("period", { ascending: false }).limit(200) : Promise.resolve({ data: [] as Row<"telematics_scores">[] }),
    list.length ? db.from("telematics_trips").select("*").in("enrolment_id", list.map((e) => e.id)).gte("started_at", monthKey(now)).limit(2000) : Promise.resolve({ data: [] as Row<"telematics_trips">[] }),
  ]);
  const counts = new Map<string, { total: number; last30: number; km30: number; last: string | null }>();
  if (list.length) {
    const { data: recent } = await db.from("telematics_trips").select("enrolment_id, started_at, distance_km").in("enrolment_id", list.map((e) => e.id)).gte("started_at", since30).limit(2000);
    for (const t of recent ?? []) {
      const c = counts.get(t.enrolment_id) ?? { total: 0, last30: 0, km30: 0, last: null };
      c.last30++;
      c.km30 += Number(t.distance_km);
      if (!c.last || t.started_at > c.last) c.last = t.started_at;
      counts.set(t.enrolment_id, c);
    }
    await Promise.all(
      list.map(async (e) => {
        const { count } = await db.from("telematics_trips").select("id", { count: "exact", head: true }).eq("enrolment_id", e.id);
        const c = counts.get(e.id) ?? { total: 0, last30: 0, km30: 0, last: null };
        c.total = count ?? 0;
        c.last = c.last ?? e.last_trip_at;
        counts.set(e.id, c);
      }),
    );
  }
  const period = monthKey(now);
  return {
    consent: { granted: consent?.granted === true, version: consent?.version ?? null, at: consent?.created_at ?? null, wording: TELEMATICS_CONSENT },
    policies: motor.map((p) => {
      const e = activeByPolicy.get(p.id) ?? list.find((x) => x.policy_id === p.id) ?? null;
      const items = (p.insured_items ?? {}) as Record<string, unknown>;
      const vehicle = [items.vehicle_make, items.vehicle_model, items.vehicle_year].filter(Boolean).join(" ");
      return {
        id: p.id,
        policyNumber: p.policy_number ?? p.internal_reference,
        label: p.nickname || vehicle || p.summary || "Motor policy",
        insurerName: (p.insurer as unknown as { name?: string } | null)?.name ?? "Insurer",
        status: p.status,
        coverEnd: p.cover_end,
        enrolment: e ? { id: e.id, status: e.status, enrolledAt: e.enrolled_at, withdrawnAt: e.withdrawn_at, deviceLabel: e.device_label, monthsOfData: e.months_of_data } : null,
      };
    }),
    enrolments: list.map((e) => {
      const months = (scores ?? []).filter((s) => s.enrolment_id === e.id);
      const currentTrips = tripsInMonth((trips ?? []).filter((t) => t.enrolment_id === e.id).map(toTrip), period);
      const summary = safeDriverSummary(months.map((m) => ({ period: m.period, score: m.score, final: m.final })), now);
      const c = counts.get(e.id) ?? { total: 0, last30: 0, km30: 0, last: e.last_trip_at };
      return {
        id: e.id,
        policyId: e.policy_id,
        status: e.status,
        enrolledAt: e.enrolled_at,
        withdrawnAt: e.withdrawn_at,
        monthsOfData: e.months_of_data,
        current: { period, ...scoreTrips(currentTrips) },
        months: months.map((m) => ({ period: m.period, score: m.score, final: m.final, trips: m.trips, distanceKm: Number(m.distance_km), factors: m.factors })),
        summary: summary ? { averageScore: summary.averageScore, monthsOfData: summary.monthsOfData } : null,
        trips: { last30Days: c.last30, distanceKm30Days: Math.round(c.km30 * 10) / 10, total: c.total, lastTripAt: c.last },
      };
    }),
    scoring: { version: TELEMATICS_SCORING.version, weights: TELEMATICS_SCORING.weights, minTrips: TELEMATICS_SCORING.minTrips, minDistanceKm: TELEMATICS_SCORING.minDistanceKm, lookbackMonths: TELEMATICS_SCORING.lookbackMonths },
  };
}

export interface IngestResult {
  enrolmentId: string;
  accepted: number;
  duplicates: number;
  rejected: { tripId: string; reason: string }[];
}

/**
 * Batch trip upload. The enrolment is read with the caller's RLS client (own rows only) and must be active with
 * the consent still granted; rows are then written by the server. Idempotent by trip id (a repeat is a
 * `duplicate`, never an error); a withdrawn enrolment is refused by the database guard as well.
 */
export async function ingestTrips(db: UserClient, userId: string, input: TelematicsTripsInput): Promise<IngestResult> {
  const { data: enrolment } = await db.from("telematics_enrolments").select("id, status, user_id, policy_id").eq("id", input.enrolmentId).eq("user_id", userId).maybeSingle();
  if (!enrolment) throw dbError({ code: "PGRST116" }, "Enrolment not found.");
  if (enrolment.status !== "active") throw dbError({ code: "P0001", message: "Driving-score collection has been withdrawn for this policy. Enrol again to continue." });
  const { data: consent } = await db.from("consents").select("granted").eq("user_id", userId).eq("type", "telematics").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!consent?.granted) throw dbError({ code: "P0001", message: "Telematics consent has been withdrawn." });

  const svc = createServiceClient();
  const result: IngestResult = { enrolmentId: enrolment.id, accepted: 0, duplicates: 0, rejected: [] };
  const seen = new Set<string>();
  let lastTrip: string | null = null;
  for (const t of input.trips) {
    if (seen.has(t.tripId)) {
      result.duplicates++;
      continue;
    }
    seen.add(t.tripId);
    if (Date.parse(t.endedAt) <= Date.parse(t.startedAt)) {
      result.rejected.push({ tripId: t.tripId, reason: "The trip ends before it starts." });
      continue;
    }
    const { data, error } = await svc
      .from("telematics_trips")
      .upsert(
        {
          enrolment_id: enrolment.id,
          policy_id: enrolment.policy_id,
          user_id: enrolment.user_id,
          trip_id: t.tripId,
          started_at: t.startedAt,
          ended_at: t.endedAt,
          distance_km: t.distanceKm,
          max_speed_band: t.maxSpeedBand,
          harsh_brake_count: t.harshBrakeCount,
          harsh_accel_count: t.harshAccelCount,
          night_share: t.nightShare,
          phone_use: t.phoneUse,
        },
        { onConflict: "enrolment_id,trip_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      if (error.code === "P0001") throw dbError(error);
      result.rejected.push({ tripId: t.tripId, reason: error.code === "23514" ? "A value is outside the allowed range." : "Not accepted." });
      continue;
    }
    if (data?.length) {
      result.accepted++;
      if (!lastTrip || t.startedAt > lastTrip) lastTrip = t.startedAt;
    } else result.duplicates++;
  }
  if (lastTrip) await svc.from("telematics_enrolments").update({ last_trip_at: lastTrip }).eq("id", enrolment.id).or(`last_trip_at.is.null,last_trip_at.lt.${lastTrip}`);
  return result;
}

/**
 * Monthly cron: for every enrolment with trips, store last month's FINAL score and this month's provisional
 * one; refresh months_of_data and latest_score. Upserts on (enrolment, period), so a re-run changes nothing.
 */
export async function telematicsScoring(svc: Svc, now = new Date()): Promise<Record<string, unknown>> {
  const previous = previousMonthKey(now);
  const current = monthKey(now);
  const nextMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
  const { data: enrolments } = await svc.from("telematics_enrolments").select("id, status, withdrawn_at").or(`status.eq.active,withdrawn_at.gte.${previous}`).limit(5000);
  let scored = 0;
  let enrolmentsUpdated = 0;
  for (const e of enrolments ?? []) {
    try {
      const { data: trips } = await svc.from("telematics_trips").select("*").eq("enrolment_id", e.id).gte("started_at", previous).lt("started_at", nextMonth).limit(5000);
      const all = (trips ?? []).map(toTrip);
      for (const [period, final] of [
        [previous, true],
        [current, false],
      ] as const) {
        const month = tripsInMonth(all, period);
        if (!month.length && !final) continue;
        const s = scoreTrips(month);
        const { error } = await svc.from("telematics_scores").upsert(
          { enrolment_id: e.id, policy_id: "00000000-0000-0000-0000-000000000000", user_id: "00000000-0000-0000-0000-000000000000", period, score: s.score, factors: s.factors as unknown as Json, trips: s.trips, distance_km: s.distanceKm, final, scoring_version: s.scoringVersion },
          { onConflict: "enrolment_id,period" },
        );
        if (error) throw error;
        scored++;
      }
      const { data: finals } = await svc.from("telematics_scores").select("period, score, final").eq("enrolment_id", e.id).order("period", { ascending: false }).limit(24);
      const summary = safeDriverSummary((finals ?? []).map((m) => ({ period: m.period, score: m.score, final: m.final })), now);
      const latest = (finals ?? []).find((m) => m.final && m.score !== null)?.score ?? null;
      await svc.from("telematics_enrolments").update({ months_of_data: summary?.monthsOfData ?? 0, latest_score: latest }).eq("id", e.id);
      enrolmentsUpdated++;
    } catch (err) {
      log.error("telematics.scoring_failed", { enrolmentId: e.id, err });
    }
  }
  return { enrolments: enrolments?.length ?? 0, scored, enrolments_updated: enrolmentsUpdated, previous_month: previous, current_month: current };
}

/** Enrol the signed-in customer (RPC: ownership, motor-only, consent and one-active-per-policy are checked in the database). */
export async function enrolTelematics(db: AnyClient, args: { policyId: string; deviceId: string; deviceLabel?: string | null }) {
  const { data, error } = await db.rpc("enrol_telematics", { p_policy_id: args.policyId, p_device_id: args.deviceId, p_device_label: args.deviceLabel ?? undefined });
  if (error) throw dbError(error, "We couldn't enrol this policy.");
  return data;
}

export async function withdrawTelematics(db: AnyClient, enrolmentId: string, reason?: string | null) {
  const { data, error } = await db.rpc("withdraw_telematics", { p_enrolment_id: enrolmentId, p_reason: reason ?? undefined });
  if (error) throw dbError(error, "We couldn't withdraw this enrolment.");
  return data;
}
