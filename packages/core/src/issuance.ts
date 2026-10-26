/**
 * Issuance decisions (Addendum 2 A): which path a paid order takes once the policy row exists.
 * Pure helpers; the server (`apps/web/src/server/issuance.ts`) loads the facts and acts.
 *
 *   L2 + rules accept  → delegated: Covva allocates the number, renders documents, cover is
 *                        active at once and the insurer has a review window to endorse/cancel.
 *   L2 + refer/decline → referred to the insurer's Level 1 queue with the rule outcome shown.
 *   L3                 → queued for the insurer's API adapter.
 *   L1 / anything else → insurer portal (existing manual flow) with an SLA timer.
 */
import type { IntegrationLevel } from "./routing-engine";
import type { IssuanceType, RuleOutcome } from "./underwriting";

export type IssuanceMode = "delegated" | "insurer_portal" | "api";
export const ISSUANCE_MODES: IssuanceMode[] = ["delegated", "insurer_portal", "api"];

export type IssuanceJobStatus = "queued" | "generating" | "issued" | "referred" | "review_window" | "endorsed" | "cancelled" | "failed";
export const ISSUANCE_JOB_STATUSES: IssuanceJobStatus[] = ["queued", "generating", "issued", "referred", "review_window", "endorsed", "cancelled", "failed"];

export interface IssuanceIntegration {
  level: IntegrationLevel | string | null | undefined;
  /** `insurer_line_integrations.sla_hours` (review window for L2, issuance SLA for L1). */
  slaHours?: number | null;
  /** `insurer_line_integrations.issuance_type`, or the product version's when set. */
  issuanceType?: IssuanceType | string | null;
  active?: boolean | null;
}

export interface IssuanceOutcome {
  fits: boolean;
  outcome: RuleOutcome;
  reason: string;
}

export interface IssuanceModeDecision {
  mode: IssuanceMode;
  /** Initial `issuance_jobs.status` for this mode. */
  status: IssuanceJobStatus;
  /** Review window (L2) or expected issuance SLA (L1/L3) in hours. */
  slaHours: number;
  reason: string;
}

export const DEFAULT_SLA_HOURS = 24;

function hours(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(720, Math.floor(v)) : DEFAULT_SLA_HOURS;
}

/**
 * Decides the issuance mode from the insurer's line integration and the underwriting outcome.
 * `outcome` may be omitted for L1/L3 (rules only matter for delegated issuance).
 */
export function decideIssuanceMode(integration: IssuanceIntegration | null | undefined, outcome?: IssuanceOutcome | null): IssuanceModeDecision {
  const slaHours = hours(integration?.slaHours);
  const level = integration && integration.active !== false ? String(integration.level ?? "L1").toUpperCase() : "L1";
  if (level === "L3") {
    return { mode: "api", status: "queued", slaHours, reason: "Insurer connected by API: queued for the adapter." };
  }
  if (level === "L2") {
    if (!outcome) {
      return { mode: "insurer_portal", status: "referred", slaHours, reason: "Underwriting rules could not be evaluated; referred to the insurer for review." };
    }
    if (outcome.fits && outcome.outcome === "accept") {
      return { mode: "delegated", status: "generating", slaHours, reason: "Fits delegated issuance: Covva issues on the insurer's behalf." };
    }
    return { mode: "insurer_portal", status: "referred", slaHours, reason: outcome.reason || "Outside the delegated rules; referred to the insurer for review." };
  }
  return { mode: "insurer_portal", status: "queued", slaHours, reason: "Insurer issues through its portal." };
}

/** End of the insurer's review window for a delegated policy. */
export function reviewWindowEnd(issuedAt: Date, slaHours: number): Date {
  return new Date(issuedAt.getTime() + hours(slaHours) * 3_600_000);
}

export type SlaEscalationLevel = 0 | 1 | 2 | 3;

/**
 * Escalation ladder for an SLA timer (Addendum 2 A): level 1 at due (insurer contacts),
 * level 2 at due + 50% (Covva ops), level 3 = final breach at 2× due (customer chooses
 * refund or re-route). Returns the level the timer should be at `now`.
 */
export function slaEscalationLevel(startedAt: Date, dueAt: Date, now: Date): SlaEscalationLevel {
  const span = Math.max(dueAt.getTime() - startedAt.getTime(), 60_000);
  const t = now.getTime();
  if (t >= dueAt.getTime() + span) return 3;
  if (t >= dueAt.getTime() + span / 2) return 2;
  if (t >= dueAt.getTime()) return 1;
  return 0;
}

/** When each escalation level kicks in, for display ("Expected by …"). */
export function slaMilestones(startedAt: Date, dueAt: Date): { due: Date; opsAt: Date; finalAt: Date } {
  const span = Math.max(dueAt.getTime() - startedAt.getTime(), 60_000);
  return { due: dueAt, opsAt: new Date(dueAt.getTime() + span / 2), finalAt: new Date(dueAt.getTime() + span) };
}

/** Random base32 verification code (Crockford alphabet, no I/L/O/U) — mirrors the DB trigger. */
export const VERIFICATION_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function isVerificationCode(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(s.toUpperCase());
}

/** Masks a policy number for public verification (last 4 visible). */
export function maskPolicyNumber(n: string | null | undefined): string | null {
  if (!n) return null;
  const s = String(n);
  if (s.length <= 4) return s;
  return `${"•".repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}`;
}

export function verifyUrl(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/$/, "")}/verify?q=${encodeURIComponent(code)}`;
}
