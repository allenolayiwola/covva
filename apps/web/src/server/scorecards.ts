import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheLife, cacheTag } from "next/cache";
import {
  SCORECARD_WINDOWS,
  computeScorecard,
  parseScorecardInputs,
  scorecardRow,
  type ResponseBand,
  type ScoreBand,
  type ScorecardComponent,
  type ScorecardSuggestion,
  type ScorecardWindow,
} from "@im/core";
import type { Database, Json, Row } from "@im/db";
import { createPublicClient, createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";
import { BusinessRuleError, ruleMessage } from "@/server/requests";

/**
 * Broker scorecards and reviews (roadmap Phase 4). The raw measures come from the SECURITY
 * DEFINER function `broker_scorecard_inputs` (migration 20261031100400); the composite score is
 * `@im/core` computeScorecard; snapshots live in `broker_scorecards` (one per broker and window)
 * and are refreshed by the `scorecard-refresh` cron. Public summaries are read through
 * `broker_score_summary` (public aggregates) and the service-only `broker_public_reviews`
 * (approved text with masked reviewer names).
 */
type Db = SupabaseClient<Database>;
type Svc = ReturnType<typeof createServiceClient>;

export type ScorecardRow = Row<"broker_scorecards">;
export type BrokerReview = Row<"broker_reviews">;
export type ReviewSubjectType = "request" | "claim";

export interface ScorecardView extends Omit<ScorecardRow, "components" | "suggestions"> {
  components: ScorecardComponent[];
  suggestions: ScorecardSuggestion[];
}

export function toScorecardView(row: ScorecardRow): ScorecardView {
  return {
    ...row,
    components: (Array.isArray(row.components) ? row.components : []) as unknown as ScorecardComponent[],
    suggestions: (Array.isArray(row.suggestions) ? row.suggestions : []) as unknown as ScorecardSuggestion[],
  };
}

// ---------------------------------------------------------------------------
// Refresh (cron)
// ---------------------------------------------------------------------------
/** Recomputes every active broker's 30- and 90-day scorecard. Idempotent (upsert per broker × window). */
export async function refreshBrokerScorecards(svc: Svc, opts: { brokerOrgIds?: string[] } = {}): Promise<Record<string, unknown>> {
  let q = svc.from("organizations").select("id").eq("type", "broker").in("status", ["active", "suspended"]).order("id").limit(5000);
  if (opts.brokerOrgIds?.length) q = q.in("id", opts.brokerOrgIds);
  const { data: brokers, error } = await q;
  if (error) throw error;
  let written = 0;
  let failed = 0;
  const now = new Date();
  for (const b of brokers ?? []) {
    for (const window of SCORECARD_WINDOWS) {
      try {
        const { data, error: rpcErr } = await svc.rpc("broker_scorecard_inputs", { p_broker_org_id: b.id, p_days: window });
        if (rpcErr) throw rpcErr;
        const inputs = parseScorecardInputs(data);
        const card = computeScorecard(inputs);
        const row = scorecardRow({ ...inputs, broker_org_id: b.id, window_days: window }, card, now);
        const { error: upErr } = await svc.from("broker_scorecards").upsert({ ...row, components: row.components as unknown as Json, suggestions: row.suggestions as unknown as Json }, { onConflict: "broker_org_id,window_days" });
        if (upErr) throw upErr;
        written++;
      } catch (err) {
        failed++;
        log.error("scorecards.refresh_failed", { brokerOrgId: b.id, window, err });
      }
    }
  }
  return { brokers: brokers?.length ?? 0, written, failed, windows: [...SCORECARD_WINDOWS] };
}

// ---------------------------------------------------------------------------
// Reads (RLS client: brokers see their own, insurers their appointed brokers, staff all)
// ---------------------------------------------------------------------------
export async function loadScorecards(db: Db, brokerOrgId: string): Promise<Partial<Record<ScorecardWindow, ScorecardView>>> {
  const { data } = await db.from("broker_scorecards").select("*").eq("broker_org_id", brokerOrgId);
  const out: Partial<Record<ScorecardWindow, ScorecardView>> = {};
  for (const row of data ?? []) if (row.window_days === 30 || row.window_days === 90) out[row.window_days] = toScorecardView(row);
  return out;
}

/** Live measures for a window (members, appointed insurers, staff), computed on demand when no snapshot exists yet. */
export async function liveScorecard(db: Db, brokerOrgId: string, window: ScorecardWindow) {
  const { data, error } = await db.rpc("broker_scorecard_inputs", { p_broker_org_id: brokerOrgId, p_days: window });
  if (error) throw new BusinessRuleError(ruleMessage(error, "We couldn't compute the scorecard."), error.code === "42501" ? "forbidden" : "business_rule");
  const inputs = parseScorecardInputs(data);
  return { inputs, card: computeScorecard(inputs) };
}

export interface InsurerBrokerScorecard {
  brokerOrgId: string;
  brokerName: string;
  scorecard: ScorecardView | null;
}

/** Scorecards of the brokers appointed to an insurer (RLS: appointed insurers read; no customer data). */
export async function loadScorecardsForInsurer(db: Db, insurerOrgId: string): Promise<InsurerBrokerScorecard[]> {
  const { data: appts } = await db.from("insurer_broker_appointments").select("broker_org_id, broker:organizations!insurer_broker_appointments_broker_org_id_fkey(id, name)").eq("insurer_org_id", insurerOrgId).eq("active", true).limit(500);
  const brokers = new Map<string, string>();
  for (const a of appts ?? []) {
    const b = a.broker as unknown as { id: string; name: string } | null;
    if (b) brokers.set(b.id, b.name);
  }
  if (!brokers.size) return [];
  const { data: cards } = await db.from("broker_scorecards").select("*").in("broker_org_id", [...brokers.keys()]).eq("window_days", 90);
  const byBroker = new Map((cards ?? []).map((c) => [c.broker_org_id, toScorecardView(c)]));
  return [...brokers.entries()]
    .map(([brokerOrgId, brokerName]) => ({ brokerOrgId, brokerName, scorecard: byBroker.get(brokerOrgId) ?? null }))
    .sort((a, b) => (b.scorecard?.score ?? -1) - (a.scorecard?.score ?? -1) || a.brokerName.localeCompare(b.brokerName));
}

// ---------------------------------------------------------------------------
// Public summaries (anonymous, cacheable)
// ---------------------------------------------------------------------------
export interface PublicScoreSummary {
  brokerOrgId: string;
  ratingAvg: number | null;
  reviewCount: number;
  responseBand: ResponseBand | null;
  scoreBand: ScoreBand;
  computedAt: string | null;
}

export async function getPublicScoreSummaries(brokerOrgIds: string[]): Promise<Record<string, PublicScoreSummary>> {
  "use cache";
  cacheLife("hours");
  cacheTag("scorecards");
  const ids = [...new Set(brokerOrgIds)].sort();
  if (!ids.length) return {};
  const out: Record<string, PublicScoreSummary> = {};
  // Match the database's bounded public input without truncating large directories.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await createPublicClient().rpc("broker_score_summary", { p_broker_org_ids: ids.slice(offset, offset + 100) });
    if (error) {
      log.warn("scorecards.summary_failed", { err: error });
      return {};
    }
    for (const r of data ?? []) {
      out[r.broker_org_id] = {
        brokerOrgId: r.broker_org_id,
        ratingAvg: r.rating_avg == null ? null : Number(r.rating_avg),
        reviewCount: Number(r.review_count ?? 0),
        responseBand: (r.response_band as ResponseBand | null) ?? null,
        scoreBand: (r.score_band as ScoreBand) ?? "new",
        computedAt: r.computed_at ?? null,
      };
    }
  }
  return out;
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  displayName: string;
  subjectType: ReviewSubjectType;
  createdAt: string;
  repliedAt: string | null;
}

export async function getPublicReviews(brokerOrgId: string, limit = 10): Promise<PublicReview[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("scorecards", `reviews:${brokerOrgId}`);
  const { data, error } = await createServiceClient().rpc("broker_public_reviews", { p_broker_org_id: brokerOrgId, p_limit: limit });
  if (error) {
    log.warn("scorecards.reviews_failed", { brokerOrgId, err: error });
    return [];
  }
  return (data ?? []).map((r) => ({ id: r.id, rating: r.rating, comment: r.comment ?? null, reply: r.reply ?? null, displayName: r.display_name, subjectType: r.subject_type as ReviewSubjectType, createdAt: r.created_at, repliedAt: r.replied_at ?? null }));
}

// ---------------------------------------------------------------------------
// Ratings and replies (RLS client; the database guard enforces the rules)
// ---------------------------------------------------------------------------
export async function rateBroker(db: Db, args: { userId: string; subjectType: ReviewSubjectType; subjectId: string; brokerOrgId: string; rating: number; comment?: string | null }): Promise<BrokerReview> {
  const { data, error } = await db
    .from("broker_reviews")
    .insert({ broker_org_id: args.brokerOrgId, customer_id: args.userId, subject_type: args.subjectType, subject_id: args.subjectId, rating: Math.round(args.rating), comment: args.comment?.trim() || null })
    .select("*")
    .single();
  if (error?.code === "23505") throw new BusinessRuleError("You've already rated your broker for this. Thank you!", "conflict");
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't save your rating."), error?.code === "42501" ? "forbidden" : "business_rule");
  return data;
}

/** The caller's own review for a subject (customers read their own rows through RLS). */
export async function myBrokerReview(db: Db, subjectType: ReviewSubjectType, subjectId: string): Promise<Pick<BrokerReview, "id" | "rating" | "comment" | "status" | "reply"> | null> {
  const { data } = await db.from("broker_reviews").select("id, rating, comment, status, reply").eq("subject_type", subjectType).eq("subject_id", subjectId).maybeSingle();
  return data ?? null;
}

/** Approved reviews of the broker's own organisation, for the scorecard page (with replies). */
export async function brokerOwnReviews(db: Db, brokerOrgId: string, limit = 50): Promise<BrokerReview[]> {
  const { data } = await db.from("broker_reviews").select("*").eq("broker_org_id", brokerOrgId).eq("status", "approved").order("created_at", { ascending: false }).limit(limit);
  return data ?? [];
}

export async function replyToReview(db: Db, reviewId: string, reply: string): Promise<void> {
  const text = reply.trim();
  if (!text) throw new BusinessRuleError("Write a reply first.");
  if (text.length > 600) throw new BusinessRuleError("Keep your reply under 600 characters.");
  const { data, error } = await db.from("broker_reviews").update({ reply: text }).eq("id", reviewId).select("id");
  if (error) throw new BusinessRuleError(ruleMessage(error, "We couldn't save your reply."), error.code === "42501" ? "forbidden" : "business_rule");
  if (!data?.length) throw new BusinessRuleError("This review is not available to reply to.", "not_found");
}
