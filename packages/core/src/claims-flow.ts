import type { ClaimStatus, Party } from "./status.ts";

/**
 * Customer-facing claim journey (Roadmap Phase 2): fixed stages with the time each one is
 * expected to take, so the app never shows an open-ended "processing". Expected dates are
 * computed from the timestamp of the previous stage; the insurer still decides the outcome.
 */
export type ClaimStage = "reported" | "acknowledged" | "assessing" | "decision" | "payment";

export interface ClaimTimelineStage {
  key: ClaimStage;
  label: string;
  /** What the customer should expect at this stage. */
  hint: string;
  /** Expected duration of this stage once it starts. `hours` or working `days` (Mon–Fri). */
  expected: { hours: number } | { workingDays: number } | null;
  expectedLabel: string | null;
  /** Claim statuses that mean this stage has been reached or passed. */
  statuses: ClaimStatus[];
}

export const CLAIM_TIMELINE: ClaimTimelineStage[] = [
  { key: "reported", label: "Reported", hint: "Your report and evidence reach your broker and the insurer.", expected: null, expectedLabel: null, statuses: ["reported", "delivered_to_insurer"] },
  { key: "acknowledged", label: "Acknowledged by the insurer", hint: "The insurer confirms it has your claim and gives you a reference.", expected: { hours: 24 }, expectedLabel: "within 24 hours", statuses: ["acknowledged"] },
  { key: "assessing", label: "Assessment", hint: "The insurer checks the evidence and may ask for more information or an inspection.", expected: { workingDays: 5 }, expectedLabel: "about 5 working days", statuses: ["under_assessment", "info_requested"] },
  { key: "decision", label: "Decision", hint: "Approved, partially approved or declined, with reasons.", expected: null, expectedLabel: "after assessment", statuses: ["approved", "partially_approved", "rejected"] },
  { key: "payment", label: "Payment or repair", hint: "Settlement to your wallet or bank, or directly to the garage or hospital.", expected: { workingDays: 10 }, expectedLabel: "within 10 working days of approval", statuses: ["paid", "closed"] },
];

const STAGE_INDEX: Partial<Record<ClaimStatus, number>> = {};
CLAIM_TIMELINE.forEach((s, i) => s.statuses.forEach((st) => (STAGE_INDEX[st] = i)));

/** Index of the stage a status belongs to; -1 for draft/withdrawn. */
export function claimStageIndex(status: ClaimStatus): number {
  return STAGE_INDEX[status] ?? -1;
}

/** Add N working days (Mon–Fri) to a date. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

export function expectedBy(from: Date, expected: ClaimTimelineStage["expected"]): Date | null {
  if (!expected) return null;
  if ("hours" in expected) return new Date(from.getTime() + expected.hours * 3_600_000);
  return addWorkingDays(from, expected.workingDays);
}

export interface ClaimEventLike { to_status?: ClaimStatus | string | null; created_at: string }
export interface ClaimLike {
  status: ClaimStatus;
  reported_at?: string | null;
  delivered_to_insurer_at?: string | null;
  acknowledged_at?: string | null;
  decision_at?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
}

export interface NextExpectedStep {
  stage: ClaimTimelineStage | null;
  /** When the next stage is expected to be reached, from the previous stage's timestamp. */
  expectedBy: Date | null;
  /** The next stage is late against its expected time (as of `now`). */
  overdue: boolean;
  /** True when the claim is closed, withdrawn, declined or paid: nothing more to wait for. */
  done: boolean;
  /** Human sentence for the customer. */
  message: string;
}

const DONE: ClaimStatus[] = ["paid", "closed", "withdrawn", "rejected"];

/** When the current stage started: the latest event into a status of that stage, else the claim timestamps. */
function stageStartedAt(claim: ClaimLike, events: readonly ClaimEventLike[], idx: number): Date | null {
  const stage = CLAIM_TIMELINE[idx];
  if (!stage) return null;
  const fromEvents = events
    .filter((e) => e.to_status && (stage.statuses as string[]).includes(e.to_status))
    .map((e) => new Date(e.created_at).getTime())
    .filter((t) => Number.isFinite(t));
  if (fromEvents.length) return new Date(Math.max(...fromEvents));
  const fallback =
    stage.key === "reported" ? (claim.reported_at ?? claim.created_at)
    : stage.key === "acknowledged" ? claim.acknowledged_at
    : stage.key === "decision" ? claim.decision_at
    : stage.key === "payment" ? claim.paid_at
    : null;
  return fallback ? new Date(fallback) : null;
}

/**
 * What the customer should expect next and by when. Never implies approval: the decision
 * stage's message says the insurer decides.
 */
export function nextExpectedStep(claim: ClaimLike, events: readonly ClaimEventLike[] = [], now: Date = new Date()): NextExpectedStep {
  if (DONE.includes(claim.status) || claim.status === "draft") {
    const msg =
      claim.status === "paid" ? "The insurer has paid this claim." :
      claim.status === "rejected" ? "The insurer declined this claim. You can ask your broker to explain or raise a complaint." :
      claim.status === "withdrawn" ? "You withdrew this claim." :
      claim.status === "draft" ? "Finish reporting the claim to start the clock." : "This claim is closed.";
    return { stage: null, expectedBy: null, overdue: false, done: claim.status !== "draft", message: msg };
  }
  const idx = claimStageIndex(claim.status);
  const next = CLAIM_TIMELINE[idx + 1] ?? null;
  if (!next) return { stage: null, expectedBy: null, overdue: false, done: true, message: "This claim is complete." };
  const startedAt = stageStartedAt(claim, events, idx) ?? (claim.created_at ? new Date(claim.created_at) : now);
  const by = expectedBy(startedAt, next.expected);
  const overdue = !!by && by.getTime() < now.getTime();
  let message: string;
  if (claim.status === "info_requested") message = "The insurer needs more information from you. Assessment continues once you reply.";
  else if (next.key === "decision") message = "The insurer is assessing your claim and will record a decision with reasons. Only the insurer decides.";
  else if (by) message = `${next.label} expected ${next.expectedLabel}${overdue ? " — this is taking longer than expected; your broker can chase it" : ""}.`;
  else message = `${next.label} is next.`;
  return { stage: next, expectedBy: by, overdue, done: false, message };
}

/** Parties who may post in the claim thread; closed claims take messages only from partners/staff for 30 days of wrap-up. */
export function canMessage(party: Party | "sponsor", claim: Pick<ClaimLike, "status">): boolean {
  if (claim.status === "draft") return party !== "customer" ? false : true;
  if (party === "system" || party === "ai") return false;
  if (["withdrawn", "closed"].includes(claim.status)) return party === "insurer" || party === "broker" || party === "platform";
  return true;
}

export const MAX_VIDEO_SECONDS = 90;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];

export function isVideoMime(mime: string | null | undefined): mime is VideoMimeType {
  return !!mime && (VIDEO_MIME_TYPES as readonly string[]).includes(mime.split(";")[0]!.trim().toLowerCase());
}

/** Validate a claim video before upload (duration is known client-side from the <video> metadata). */
export function validateClaimVideo(input: { mimeType: string; sizeBytes: number; durationSeconds?: number | null }): { ok: true } | { ok: false; reason: string } {
  if (!isVideoMime(input.mimeType)) return { ok: false, reason: "Record or choose an MP4, WebM or QuickTime video." };
  if (input.sizeBytes <= 0) return { ok: false, reason: "The video is empty." };
  if (input.sizeBytes > MAX_VIDEO_BYTES) return { ok: false, reason: `Videos must be ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB or smaller. Record a shorter clip.` };
  if (input.durationSeconds != null && Number.isFinite(input.durationSeconds) && input.durationSeconds > MAX_VIDEO_SECONDS) {
    return { ok: false, reason: `Keep the video to ${MAX_VIDEO_SECONDS} seconds or less.` };
  }
  return { ok: true };
}

export type ClaimUploadKind = "photo" | "claim_video" | "police_report" | "medical_report" | "repair_estimate" | "invoice" | "receipt" | "claim_evidence" | "other";

/**
 * Which document kinds make sense to upload at each stage. While the claim is being reported
 * (or assessed) everything is useful; after a decision only invoices/receipts for settlement;
 * nothing once paid, closed, withdrawn or declined.
 */
export function allowedUploadKinds(status: ClaimStatus): ClaimUploadKind[] {
  switch (claimStageIndex(status)) {
    case -1:
      return status === "draft" ? ["photo", "claim_video", "police_report", "medical_report", "repair_estimate", "invoice", "receipt", "claim_evidence", "other"] : [];
    case 0:
    case 1:
    case 2:
      return ["photo", "claim_video", "police_report", "medical_report", "repair_estimate", "invoice", "receipt", "claim_evidence", "other"];
    case 3:
      return status === "rejected" ? [] : ["invoice", "receipt", "repair_estimate"];
    default:
      return [];
  }
}

export const CLAIM_JOB_STATUS: Record<"requested" | "accepted" | "in_progress" | "completed" | "cancelled", { label: string; tone: "neutral" | "info" | "wait" | "ok" | "danger" }> = {
  requested: { label: "Requested", tone: "info" },
  accepted: { label: "Accepted by partner", tone: "info" },
  in_progress: { label: "In progress", tone: "wait" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const SERVICE_PARTNER_KINDS = ["garage", "towing", "hospital", "clinic", "pharmacy", "assessor"] as const;
export type ServicePartnerKind = (typeof SERVICE_PARTNER_KINDS)[number];
export const SERVICE_PARTNER_KIND_LABELS: Record<ServicePartnerKind, string> = {
  garage: "Garage", towing: "Towing", hospital: "Hospital", clinic: "Clinic", pharmacy: "Pharmacy", assessor: "Assessor",
};

/** Which partner kinds a claim category typically needs (directory card on the claim page). */
export function partnerKindsFor(categorySlug: string | null | undefined, incidentType?: string | null): ServicePartnerKind[] {
  switch (categorySlug) {
    case "motor":
      return /theft|stolen/i.test(incidentType ?? "") ? ["assessor"] : ["garage", "towing", "assessor"];
    case "health":
    case "personal-accident":
    case "travel":
      return ["hospital", "clinic", "pharmacy"];
    case "home":
    case "sme-property":
      return ["assessor"];
    default:
      return [];
  }
}

export interface ClaimTimelineRow {
  key: ClaimStage;
  label: string;
  hint: string;
  state: "done" | "current" | "upcoming";
  /** When the stage was reached (ISO), if it has been. */
  at: string | null;
  /** When the stage is expected to be reached (ISO) when it is the next one. */
  expectedBy: string | null;
  expectedLabel: string | null;
  overdue: boolean;
}

/**
 * The customer-facing timeline: every stage with its reached time or expected time. Declined claims
 * end at the decision stage; withdrawn/draft claims only show what has happened.
 */
export function buildClaimTimeline(claim: ClaimLike, events: readonly ClaimEventLike[] = [], now: Date = new Date()): ClaimTimelineRow[] {
  const idx = claimStageIndex(claim.status);
  const next = nextExpectedStep(claim, events, now);
  const last = claim.status === "rejected" ? 3 : CLAIM_TIMELINE.length - 1;
  return CLAIM_TIMELINE.slice(0, last + 1).map((stage, i) => {
    const reached = idx >= i;
    const at = reached ? (stageStartedAt(claim, events, i)?.toISOString() ?? null) : null;
    const isNext = next.stage?.key === stage.key;
    return {
      key: stage.key,
      label: stage.key === "decision" && claim.status === "rejected" ? "Decision: declined" : stage.label,
      hint: stage.hint,
      state: reached ? (i === idx && !next.done ? "current" : "done") : "upcoming",
      at,
      expectedBy: isNext && next.expectedBy ? next.expectedBy.toISOString() : null,
      expectedLabel: reached ? null : stage.expectedLabel,
      overdue: isNext && next.overdue,
    };
  });
}
