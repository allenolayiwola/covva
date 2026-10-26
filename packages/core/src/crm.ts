/**
 * Partnerships CRM domain rules (Addendum 3 D). Pure logic shared by the admin
 * console, the database rules tests and the reminders cron.
 *
 * Pipeline: Lead → Contacted → Meeting → Proposal → Agreement signed → Onboarding → Live.
 * "Lost" can be reached from any stage. Moves are one step forward or back, except
 * that "Live" requires a linked organisation (the partner exists on the platform).
 */
export const CRM_STAGES = [
  { key: "lead", label: "Lead", order: 0 },
  { key: "contacted", label: "Contacted", order: 1 },
  { key: "meeting", label: "Meeting", order: 2 },
  { key: "proposal", label: "Proposal", order: 3 },
  { key: "agreement_signed", label: "Agreement signed", order: 4 },
  { key: "onboarding", label: "Onboarding", order: 5 },
  { key: "live", label: "Live", order: 6 },
  { key: "lost", label: "Lost", order: 7 },
] as const;

export type CrmStage = (typeof CRM_STAGES)[number]["key"];
export const CRM_STAGE_KEYS = CRM_STAGES.map((s) => s.key) as CrmStage[];
/** Stages that form the forward path (everything except "lost"). */
export const CRM_PIPELINE_STAGES = CRM_STAGES.filter((s) => s.key !== "lost").map((s) => s.key) as Exclude<CrmStage, "lost">[];
export const CRM_OPEN_STAGES = CRM_PIPELINE_STAGES.filter((s) => s !== "live") as Exclude<CrmStage, "lost" | "live">[];

export const CRM_ACCOUNT_KINDS = ["insurer", "broker", "embedded_partner", "group"] as const;
export type CrmAccountKind = (typeof CRM_ACCOUNT_KINDS)[number];
export const CRM_ACCOUNT_KIND_LABEL: Record<CrmAccountKind, string> = {
  insurer: "Insurer",
  broker: "Broker",
  embedded_partner: "Embedded partner",
  group: "Group scheme",
};

export const CRM_SOURCES = ["website_form", "broker_suggestion", "rep", "referral", "event", "other"] as const;
export type CrmSource = (typeof CRM_SOURCES)[number];
export const CRM_SOURCE_LABEL: Record<CrmSource, string> = {
  website_form: "Website form",
  broker_suggestion: "Broker suggestion",
  rep: "Rep sourced",
  referral: "Referral",
  event: "Event",
  other: "Other",
};

export function crmStageLabel(stage: string): string {
  return CRM_STAGES.find((s) => s.key === stage)?.label ?? stage;
}

export function isCrmStage(s: string): s is CrmStage {
  return (CRM_STAGE_KEYS as string[]).includes(s);
}

export function crmStageOrder(stage: CrmStage): number {
  return CRM_STAGES.find((s) => s.key === stage)!.order;
}

export interface StageMoveResult {
  ok: boolean;
  reason?: string;
}

/**
 * Can an account move from `from` to `to`?
 *  - forward or back exactly one step along the pipeline
 *  - "lost" from any open stage (and back out of "lost" to "lead" only, to re-open)
 *  - "live" only when the account is linked to an organisation
 */
export function canMoveStage(from: CrmStage, to: CrmStage, opts: { hasOrg?: boolean } = {}): StageMoveResult {
  if (!isCrmStage(from) || !isCrmStage(to)) return { ok: false, reason: "Unknown stage." };
  if (from === to) return { ok: false, reason: "The account is already in that stage." };
  if (to === "lost") return from === "live" ? { ok: false, reason: "A live partner is offboarded through its organisation, not marked lost." } : { ok: true };
  if (from === "lost") return to === "lead" ? { ok: true } : { ok: false, reason: "Re-open a lost account at “Lead” first." };
  const diff = crmStageOrder(to) - crmStageOrder(from);
  if (Math.abs(diff) !== 1) return { ok: false, reason: `Move one step at a time (from ${crmStageLabel(from)} you can go to ${nextStages(from).map(crmStageLabel).join(" or ")}).` };
  if (to === "live" && !opts.hasOrg) return { ok: false, reason: "Link the account to its organisation before marking it live." };
  return { ok: true };
}

/** The stages reachable in one move (ignoring the org requirement for "live"). */
export function nextStages(from: CrmStage): CrmStage[] {
  if (from === "lost") return ["lead"];
  const i = crmStageOrder(from);
  const out: CrmStage[] = [];
  const prev = CRM_PIPELINE_STAGES[i - 1];
  const next = CRM_PIPELINE_STAGES[i + 1];
  if (next) out.push(next);
  if (prev) out.push(prev);
  if (from !== "live") out.push("lost");
  return out;
}

export interface PipelineAccount {
  stage: CrmStage | string;
  estimated_value?: number | string | null;
  owner_user_id?: string | null;
  agreement_signed_at?: string | null;
  live_at?: string | null;
}

export interface PipelineSummary {
  total: number;
  open: number;
  live: number;
  lost: number;
  byStage: { stage: CrmStage; label: string; count: number; value: number }[];
  byOwner: { ownerId: string | null; count: number; value: number }[];
  /** Average days from agreement signed to live, over accounts with both timestamps. */
  avgDaysToLive: number | null;
  /** Share of non-lost accounts that are live. */
  winRate: number | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? Number.parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Pure aggregation of a list of accounts (every stage gets a row, in pipeline order). */
export function pipelineSummary(accounts: readonly PipelineAccount[]): PipelineSummary {
  const stageMap = new Map<CrmStage, { count: number; value: number }>(CRM_STAGE_KEYS.map((k) => [k, { count: 0, value: 0 }]));
  const ownerMap = new Map<string | null, { count: number; value: number }>();
  const days: number[] = [];
  let live = 0;
  let lost = 0;
  for (const a of accounts) {
    const stage = isCrmStage(a.stage) ? a.stage : "lead";
    const value = num(a.estimated_value);
    const s = stageMap.get(stage)!;
    s.count++;
    s.value += value;
    if (stage === "live") live++;
    else if (stage === "lost") lost++;
    else {
      const key = a.owner_user_id ?? null;
      const o = ownerMap.get(key) ?? { count: 0, value: 0 };
      o.count++;
      o.value += value;
      ownerMap.set(key, o);
    }
    if (a.agreement_signed_at && a.live_at) {
      const d = (Date.parse(a.live_at) - Date.parse(a.agreement_signed_at)) / 86_400_000;
      if (Number.isFinite(d) && d >= 0) days.push(d);
    }
  }
  const total = accounts.length;
  const decided = total - lost;
  return {
    total,
    open: total - live - lost,
    live,
    lost,
    byStage: CRM_STAGES.map((s) => ({ stage: s.key, label: s.label, count: stageMap.get(s.key)!.count, value: round2(stageMap.get(s.key)!.value) })),
    byOwner: [...ownerMap.entries()].map(([ownerId, v]) => ({ ownerId, count: v.count, value: round2(v.value) })).sort((a, b) => b.count - a.count || b.value - a.value),
    avgDaysToLive: days.length ? round2(days.reduce((x, y) => x + y, 0) / days.length) : null,
    winRate: decided > 0 ? round2(live / decided) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type LeadKind = "customer" | "broker" | "insurer" | "enterprise" | "press" | "other";

/**
 * Map a marketing lead to a CRM account kind. Enterprise leads become embedded
 * partners unless tagged as a group scheme. Customer/press/other leads are not
 * partnership prospects (null → skip).
 */
export function leadKindToAccountKind(kind: LeadKind | string, tags: readonly string[] = []): CrmAccountKind | null {
  switch (kind) {
    case "insurer":
      return "insurer";
    case "broker":
      return "broker";
    case "enterprise":
      return tags.some((t) => /^group(_scheme)?$/i.test(t.trim())) ? "group" : "embedded_partner";
    default:
      return null;
  }
}

/** Is a task due today or overdue (in the given time zone offset-free comparison by ISO date)? */
export function taskDueState(dueAt: string | null | undefined, now: Date = new Date()): "none" | "upcoming" | "today" | "overdue" {
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "none";
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  if (due < dayStart) return "overdue";
  if (due < dayEnd) return "today";
  return "upcoming";
}
