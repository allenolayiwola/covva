/**
 * Instalment premiums (roadmap Phase 3; build prompt "Instalment premiums (monthly/quarterly)
 * with automated collections, retries, grace periods, and lapse/reinstatement handling that
 * follows insurer rules"). Pure scheduling / state logic; collections live in
 * apps/web/src/server/instalments.ts.
 *
 * Money rules:
 *  - Every instalment is a premium payment to the INSURER in GHS. Covva never holds it.
 *  - Arithmetic is in pesewas. The surcharge and deposit are percentages rounded half up to the
 *    pesewa; the instalments after the deposit are equal and any remainder goes on the LAST one,
 *    so the parts always add up to the total exactly.
 *  - Grace, lapse and reinstatement come from the insurer's plan on the product version and are
 *    snapshotted on the schedule; Covva applies them, it never sets them.
 */
import { pctOfMinor } from "./splits";

export const INSTALMENT_PLAN_KEYS = ["monthly", "quarterly"] as const;
export type InstalmentPlanKey = (typeof INSTALMENT_PLAN_KEYS)[number];

export const SCHEDULE_STATUSES = ["active", "grace", "lapsed", "completed", "cancelled", "reinstated"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const INSTALMENT_STATUSES = ["due", "paid", "failed", "waived", "cancelled"] as const;
export type InstalmentStatus = (typeof INSTALMENT_STATUSES)[number];

export interface ReinstatementRule {
  allowed: boolean;
  /** Days after the lapse in which the customer may reinstate by paying the arrears. */
  within_days: number;
  /** The insurer must review (and approve) the reinstatement before cover resumes. */
  requires_review: boolean;
}

export interface InstalmentPlan {
  key: InstalmentPlanKey;
  /** Number of instalments, the first (deposit) included. */
  count: number;
  /** First instalment as % of the total (0 = all instalments equal). */
  deposit_pct: number;
  /** Instalment surcharge as % of the premium (the insurer's charge for paying in parts). */
  surcharge_pct: number;
  /** Days after a missed due date during which cover stays in force. */
  grace_days: number;
  /** Days after a missed due date after which the insurer lapses the cover (≥ grace_days). */
  lapse_after_days: number;
  reinstatement: ReinstatementRule;
}

export const INSTALMENT_PLAN_LABEL: Record<InstalmentPlanKey, string> = { monthly: "Monthly", quarterly: "Every 3 months" };

/** Collection attempts: on the due date, then 2 and 5 days after it (MoMo prompts need the customer to approve). */
export const INSTALMENT_RETRY_DAYS = [0, 2, 5] as const;

const DAY = 86_400_000;
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function isInstalmentPlanKey(v: unknown): v is InstalmentPlanKey {
  return typeof v === "string" && (INSTALMENT_PLAN_KEYS as readonly string[]).includes(v);
}

/** One plan from stored JSON, with sane bounds; null when the key is unknown. */
export function parseInstalmentPlan(raw: unknown): InstalmentPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isInstalmentPlanKey(o.key)) return null;
  const defaultCount = o.key === "monthly" ? 12 : 4;
  const r = o.reinstatement && typeof o.reinstatement === "object" && !Array.isArray(o.reinstatement) ? (o.reinstatement as Record<string, unknown>) : {};
  const grace = clamp(Math.floor(num(o.grace_days, 14)), 0, 90);
  return {
    key: o.key,
    count: clamp(Math.floor(num(o.count, defaultCount)), 1, 24),
    deposit_pct: clamp(num(o.deposit_pct, 0), 0, 100),
    surcharge_pct: clamp(num(o.surcharge_pct, 0), 0, 100),
    grace_days: grace,
    lapse_after_days: Math.max(grace, clamp(Math.floor(num(o.lapse_after_days, grace)), 0, 180)),
    reinstatement: {
      allowed: r.allowed === true,
      within_days: clamp(Math.floor(num(r.within_days, 0)), 0, 365),
      requires_review: r.requires_review !== false,
    },
  };
}

/** `product_versions.instalment_plans` → valid plans (unknown / duplicate keys dropped). */
export function parseInstalmentPlans(raw: unknown): InstalmentPlan[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: InstalmentPlan[] = [];
  for (const item of raw) {
    const p = parseInstalmentPlan(item);
    if (p && !seen.has(p.key)) {
      seen.add(p.key);
      out.push(p);
    }
  }
  return out;
}

/** `from` plus `months` calendar months, clamped to the end of a shorter month, in UTC. */
export function addMonthsUtc(from: Date | string, months: number): Date {
  const d = typeof from === "string" ? new Date(from) : new Date(from.getTime());
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

export interface ScheduledInstalment {
  seq: number;
  /** ISO timestamp. */
  dueAt: string;
  amount: number;
}

export interface BuiltSchedule {
  planKey: InstalmentPlanKey;
  /** Premium before the surcharge. */
  premium: number;
  surcharge: number;
  /** What the customer pays in total (premium + surcharge) = sum of the instalments. */
  total: number;
  deposit: number;
  count: number;
  instalments: ScheduledInstalment[];
}

/**
 * Split `total` (GHS, the premium incl. taxes and fees) into the plan's instalments. The first is
 * due on `startDate` (paid at checkout), the rest one plan interval apart (anchored on the start,
 * so 31 Jan → 28 Feb → 31 Mar).
 */
export function buildSchedule(total: number, plan: InstalmentPlan, startDate: Date | string): BuiltSchedule {
  if (!Number.isFinite(total) || total <= 0) throw new RangeError("The total must be positive");
  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  if (Number.isNaN(start.getTime())) throw new RangeError("Invalid start date");
  const count = clamp(Math.floor(plan.count), 1, 24);
  const premiumMinor = Math.round(total * 100);
  const surchargeMinor = pctOfMinor(premiumMinor, plan.surcharge_pct);
  const grand = premiumMinor + surchargeMinor;
  if (grand < count) throw new RangeError("The total is too small to split into instalments");

  const amounts: number[] = [];
  if (count === 1) amounts.push(grand);
  else {
    let deposit = plan.deposit_pct > 0 ? pctOfMinor(grand, plan.deposit_pct) : 0;
    if (deposit > 0) {
      // Every later instalment must be at least one pesewa.
      deposit = Math.min(deposit, grand - (count - 1));
      const rest = grand - deposit;
      const each = Math.floor(rest / (count - 1));
      amounts.push(deposit);
      for (let i = 1; i < count; i++) amounts.push(each);
      amounts[count - 1]! += rest - each * (count - 1);
    } else {
      const each = Math.floor(grand / count);
      for (let i = 0; i < count; i++) amounts.push(each);
      amounts[count - 1]! += grand - each * count;
    }
  }
  const step = plan.key === "monthly" ? 1 : 3;
  const instalments = amounts.map((minor, i) => ({ seq: i + 1, dueAt: addMonthsUtc(start, i * step).toISOString(), amount: minor / 100 }));
  return { planKey: plan.key, premium: premiumMinor / 100, surcharge: surchargeMinor / 100, total: grand / 100, deposit: amounts[0]! / 100, count, instalments };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export interface InstalmentLike {
  id?: string;
  seq: number;
  due_at: string;
  amount: number | string;
  status: InstalmentStatus | string;
  attempts?: number | null;
  paid_at?: string | null;
}

export interface ScheduleLike {
  status: ScheduleStatus | string;
  plan: InstalmentPlan | unknown;
  lapsed_at?: string | null;
  reinstated_at?: string | null;
  grace_until?: string | null;
}

export type ScheduleState = "current" | "due" | "grace" | "overdue" | "lapsed" | "completed" | "cancelled";

export interface ScheduleStateResult {
  state: ScheduleState;
  /** The status the schedule row should have now (the cron moves it there). */
  status: ScheduleStatus;
  paidCount: number;
  count: number;
  total: number;
  paidAmount: number;
  outstanding: number;
  /** Unpaid amount already due (what reinstatement or "pay now" collects). */
  arrears: number;
  next: { seq: number; dueAt: string; amount: number } | null;
  /** The oldest unpaid instalment that is already due. */
  oldestUnpaidDueAt: string | null;
  daysOverdue: number;
  graceUntil: string | null;
  lapseAt: string | null;
}

const isOpen = (s: string) => s === "due" || s === "failed";
const isSettled = (s: string) => s === "paid" || s === "waived";
const sortBySeq = <T extends { seq: number }>(xs: T[]) => [...xs].sort((a, b) => a.seq - b.seq);
const toMinor = (v: number | string) => Math.round(num(v) * 100);

/** The next unpaid instalment (due or failed), by sequence. */
export function nextDue<T extends InstalmentLike>(instalments: T[]): T | null {
  return sortBySeq(instalments).find((i) => isOpen(i.status)) ?? null;
}

/**
 * Where a schedule stands at `now` under its plan:
 *   current  — nothing due yet;
 *   due      — an instalment falls due today (collection day 0);
 *   grace    — a due date was missed, still within the plan's grace days (cover stays in force);
 *   overdue  — past grace, before the plan's lapse point (the insurer may lapse soon);
 *   lapsed   — past `lapse_after_days` (or already lapsed by the insurer and not reinstated);
 *   completed / cancelled.
 */
export function scheduleState(schedule: ScheduleLike, instalments: InstalmentLike[], now: Date = new Date()): ScheduleStateResult {
  const plan = parseInstalmentPlan(schedule.plan) ?? parseInstalmentPlan({ key: "monthly" })!;
  const sorted = sortBySeq(instalments.filter((i) => i.status !== "cancelled"));
  const totalMinor = sorted.reduce((s, i) => s + toMinor(i.amount), 0);
  const paid = sorted.filter((i) => isSettled(i.status));
  const paidMinor = paid.reduce((s, i) => s + toMinor(i.amount), 0);
  const open = sorted.filter((i) => isOpen(i.status));
  const dueNow = open.filter((i) => Date.parse(i.due_at) <= now.getTime());
  const arrearsMinor = dueNow.reduce((s, i) => s + toMinor(i.amount), 0);
  const nextOpen = open[0] ?? null;
  const oldest = dueNow[0] ?? null;
  const daysOverdue = oldest ? Math.max(0, Math.floor((now.getTime() - Date.parse(oldest.due_at)) / DAY)) : 0;
  const graceUntil = oldest ? new Date(Date.parse(oldest.due_at) + plan.grace_days * DAY).toISOString() : null;
  const lapseAt = oldest ? new Date(Date.parse(oldest.due_at) + plan.lapse_after_days * DAY).toISOString() : null;

  const base = {
    paidCount: paid.length,
    count: sorted.length,
    total: totalMinor / 100,
    paidAmount: paidMinor / 100,
    outstanding: (totalMinor - paidMinor) / 100,
    arrears: arrearsMinor / 100,
    next: nextOpen ? { seq: nextOpen.seq, dueAt: nextOpen.due_at, amount: toMinor(nextOpen.amount) / 100 } : null,
    oldestUnpaidDueAt: oldest?.due_at ?? null,
    daysOverdue,
    graceUntil,
    lapseAt,
  };

  if (schedule.status === "cancelled") return { ...base, state: "cancelled", status: "cancelled" };
  if (!open.length && sorted.length) return { ...base, state: "completed", status: "completed" };
  if (schedule.status === "lapsed") return { ...base, state: "lapsed", status: "lapsed" };
  if (!oldest) return { ...base, state: "current", status: schedule.status === "reinstated" ? "reinstated" : "active" };
  const overdueMs = now.getTime() - Date.parse(oldest.due_at);
  if (overdueMs >= plan.lapse_after_days * DAY && (plan.lapse_after_days > 0 || overdueMs >= DAY)) return { ...base, state: "lapsed", status: "lapsed" };
  if (daysOverdue === 0) return { ...base, state: "due", status: schedule.status === "reinstated" ? "reinstated" : "active" };
  if (overdueMs < plan.grace_days * DAY) return { ...base, state: "grace", status: "grace" };
  return { ...base, state: "overdue", status: "grace" };
}

/** When the next collection attempt for an instalment is due (null = retries exhausted). */
export function instalmentRetryAt(dueAt: Date | string, attempts: number): Date | null {
  const n = Math.max(0, Math.floor(attempts));
  const days = INSTALMENT_RETRY_DAYS[n];
  if (days === undefined) return null;
  const d = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  return new Date(d.getTime() + days * DAY);
}

export interface ReinstatementDecision {
  allowed: boolean;
  requiresReview: boolean;
  /** Last moment the customer can reinstate (lapse + within_days). */
  deadline: string | null;
  reason: string;
}

/** Can a lapsed schedule be reinstated now, under the insurer's plan? */
export function reinstatementAllowed(schedule: ScheduleLike, now: Date = new Date()): ReinstatementDecision {
  const plan = parseInstalmentPlan(schedule.plan);
  if (schedule.status !== "lapsed") return { allowed: false, requiresReview: false, deadline: null, reason: "Only lapsed cover can be reinstated." };
  if (!plan || !plan.reinstatement.allowed) return { allowed: false, requiresReview: false, deadline: null, reason: "The insurer's plan does not allow reinstatement. Ask your broker about new cover." };
  const lapsedAt = schedule.lapsed_at ? Date.parse(schedule.lapsed_at) : NaN;
  if (Number.isNaN(lapsedAt)) return { allowed: false, requiresReview: plan.reinstatement.requires_review, deadline: null, reason: "The lapse date is unknown; the insurer must review." };
  const deadline = new Date(lapsedAt + plan.reinstatement.within_days * DAY);
  if (now.getTime() > deadline.getTime()) {
    return { allowed: false, requiresReview: plan.reinstatement.requires_review, deadline: deadline.toISOString(), reason: `Reinstatement was possible until ${fmtDate(deadline)} (${plan.reinstatement.within_days} days after the lapse).` };
  }
  return {
    allowed: true,
    requiresReview: plan.reinstatement.requires_review,
    deadline: deadline.toISOString(),
    reason: plan.reinstatement.requires_review ? "Pay the arrears; the insurer then reviews and confirms the reinstatement." : "Pay the arrears and cover resumes.",
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
function fmtDate(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
const ghs = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Instalments: 3 of 12 paid · next GH₵ 85.00 on 5 Dec 2026" (policy detail block). */
export function instalmentProgressLine(state: Pick<ScheduleStateResult, "paidCount" | "count" | "next" | "state">): string {
  const head = `Instalments: ${state.paidCount} of ${state.count} paid`;
  if (state.state === "completed") return `${head} · fully paid`;
  if (state.state === "cancelled") return `${head} · cancelled`;
  if (state.state === "lapsed") return `${head} · cover lapsed`;
  return state.next ? `${head} · next ${ghs(state.next.amount)} on ${fmtDate(state.next.dueAt)}` : head;
}

/** The insurer's rules in plain words, for checkout and the account page. */
export function planRulesText(plan: InstalmentPlan): string[] {
  const out: string[] = [];
  out.push(`${plan.count} payments${plan.key === "monthly" ? ", one a month" : ", one every 3 months"}${plan.deposit_pct > 0 ? `, the first is ${plan.deposit_pct}% of the total` : ""}.`);
  if (plan.surcharge_pct > 0) out.push(`The insurer adds ${plan.surcharge_pct}% for paying in parts.`);
  out.push(plan.grace_days > 0 ? `If a payment is missed, your cover stays in force for ${plan.grace_days} days while we retry.` : "If a payment is missed, there is no grace period.");
  out.push(`If it is still unpaid ${plan.lapse_after_days} days after the due date, the insurer lapses the cover.`);
  out.push(
    plan.reinstatement.allowed
      ? `You can reinstate within ${plan.reinstatement.within_days} days of a lapse by paying what is owed${plan.reinstatement.requires_review ? "; the insurer reviews it first" : ""}.`
      : "Lapsed cover cannot be reinstated; you would need new cover.",
  );
  return out;
}

export const SCHEDULE_STATE_LABEL: Record<ScheduleState, { label: string; tone: "ok" | "danger" | "wait" | "neutral" }> = {
  current: { label: "Up to date", tone: "ok" },
  due: { label: "Payment due today", tone: "wait" },
  grace: { label: "Payment missed — grace period", tone: "danger" },
  overdue: { label: "Overdue — cover at risk", tone: "danger" },
  lapsed: { label: "Lapsed", tone: "danger" },
  completed: { label: "Fully paid", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Mask a mobile money number for display: 0241234567 / +233241234567 → 024•••4567. */
export function maskMomoNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const local = digits.startsWith("233") ? `0${digits.slice(3)}` : digits;
  return `${local.slice(0, 3)}•••${local.slice(-4)}`;
}
