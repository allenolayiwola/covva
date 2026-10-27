/**
 * Funeral cover & welfare groups (Roadmap Phase 4): associations, churches, alumni, hometown unions and families
 * that enrol members, keep beneficiary records and collect a contribution per member per period towards a group
 * funeral / welfare cover arranged through a broker of record.
 *
 * Pure helpers shared by the web app, the partner workspace and the admin console:
 * - `contributionPeriods` / `contributionSchedule` — the periods a member owes, from the plan and their join date.
 * - `memberStanding` / `groupContributionSummary` — who is paid up, who is in arrears, what is due next.
 * - `allocateSponsorPayment` — which due contributions a sponsor abroad settles, oldest first, across the members
 *   they pay for (recorded per member: Covva always knows who paid for whom).
 * - `funeralClaimChecklist` — the documents the insurer typically needs for a death / welfare claim.
 * - `parseWelfareMemberCsv` — bulk enrolment with row-numbered errors.
 *
 * Money: every contribution is a premium payment on the group's master policy that settles to the insurer (and
 * the broker's commission) through the existing splits. Covva never pools or holds contributions.
 */
import { ghanaCardLast4, type CsvRowError } from "./sme";
import { normalisePhone, parseCsvLines } from "./onboarding";
import { CADENCE_LABEL, isCadence, type SubscriptionCadence } from "./subscriptions";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const WELFARE_GROUP_KINDS = [
  { value: "association", label: "Association" },
  { value: "church", label: "Church or religious group" },
  { value: "alumni", label: "Alumni group" },
  { value: "hometown_union", label: "Hometown union" },
  { value: "union", label: "Trade or workers' union" },
  { value: "family", label: "Family" },
  { value: "other", label: "Other group" },
] as const;
export type WelfareGroupKind = (typeof WELFARE_GROUP_KINDS)[number]["value"];
export const WELFARE_GROUP_KIND_VALUES = WELFARE_GROUP_KINDS.map((k) => k.value) as [WelfareGroupKind, ...WelfareGroupKind[]];

export function welfareKindLabel(kind: string | null | undefined): string {
  return WELFARE_GROUP_KINDS.find((k) => k.value === kind)?.label ?? "Group";
}

export const WELFARE_GROUP_STATUSES = ["draft", "quoting", "active", "lapsed", "cancelled"] as const;
export type WelfareGroupStatus = (typeof WELFARE_GROUP_STATUSES)[number];
export const WELFARE_GROUP_STATUS: Record<WelfareGroupStatus, { label: string; tone: "ok" | "wait" | "neutral" | "danger" | "info"; hint: string }> = {
  draft: { label: "Setting up", tone: "neutral", hint: "Add members and the contribution plan, then ask a licensed broker for quotes." },
  quoting: { label: "Broker quoting", tone: "wait", hint: "A licensed broker is approaching insurers for your group." },
  active: { label: "Cover in force", tone: "ok", hint: "The insurer has issued the group's master policy. Contributions keep it in force." },
  lapsed: { label: "Lapsed", tone: "danger", hint: "The insurer lapsed the cover. Talk to your broker about reinstating it." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "This group is closed." },
};

export const WELFARE_MEMBER_STATUSES = ["invited", "pending", "active", "suspended", "left"] as const;
export type WelfareMemberStatus = (typeof WELFARE_MEMBER_STATUSES)[number];
export const WELFARE_MEMBER_STATUS: Record<WelfareMemberStatus, { label: string; tone: "ok" | "wait" | "neutral" | "danger" | "info"; hint: string }> = {
  invited: { label: "Invited", tone: "wait", hint: "Added by the admin; becomes active when they join with the link, sign in with the same phone, or the admin confirms their consent." },
  pending: { label: "Awaiting approval", tone: "info", hint: "Joined with the invitation link; the admin approves them." },
  active: { label: "Active", tone: "ok", hint: "Enrolled and covered while contributions are paid." },
  suspended: { label: "Suspended", tone: "danger", hint: "Suspended by the admin (for example for unpaid contributions)." },
  left: { label: "Left", tone: "neutral", hint: "No longer a member." },
};

export const WELFARE_RELATIONSHIPS = [
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
] as const;
export type WelfareRelationship = (typeof WELFARE_RELATIONSHIPS)[number]["value"];
export const WELFARE_RELATIONSHIP_VALUES = WELFARE_RELATIONSHIPS.map((r) => r.value) as [WelfareRelationship, ...WelfareRelationship[]];

export const CONTRIBUTION_STATUSES = ["due", "paid", "waived", "failed", "cancelled"] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];
export const CONTRIBUTION_STATUS: Record<ContributionStatus, { label: string; tone: "ok" | "wait" | "neutral" | "danger" | "info" }> = {
  due: { label: "Due", tone: "wait" },
  paid: { label: "Paid", tone: "ok" },
  waived: { label: "Waived", tone: "neutral" },
  failed: { label: "Payment failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** The sentence every group page carries: Covva's role, the insurer's, the broker's. */
export function welfareDisclaimer(insurerName: string | null | undefined, brokerName: string | null | undefined): string {
  const insurer = insurerName ? `Cover is provided by ${insurerName}` : "Cover is provided by the insurer that issues the group's policy";
  const broker = brokerName ? `arranged by ${brokerName}, a licensed broker` : "arranged by a licensed broker";
  return `${insurer} and ${broker}. Covva is a marketplace: it records enrolment and contributions and never holds your money — every contribution settles directly to the insurer and broker. Only the insurer decides claims.`;
}

export const WELFARE_CONSENT_TEXT =
  "I agree to be enrolled in this group's funeral / welfare cover, and to my name, phone number, date of birth and beneficiary details being shared with the group's broker and insurer for that purpose. I can leave the group at any time.";

// ---------------------------------------------------------------------------
// Contribution schedule
// ---------------------------------------------------------------------------
export interface ContributionPlan {
  amount: number;
  cadence: SubscriptionCadence | string;
  /** Day of the month the contribution falls due (1–28). */
  day: number;
  /** First period of the plan (ISO date). */
  startsOn: string;
}

export interface ContributionPeriod {
  /** First day of the period (ISO date). */
  periodStart: string;
  /** Due date (ISO date). */
  dueAt: string;
}

const MONTHS: Record<SubscriptionCadence, number> = { monthly: 1, quarterly: 3, annual: 12 };

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function utc(dateIso: string): Date {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${dateIso}`);
  return d;
}
function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** Due date of a period: the plan day clamped to the end of the period's first month. */
export function contributionDueDate(periodStart: string, day: number): string {
  const start = utc(periodStart);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const d = Math.min(Math.max(1, Math.floor(day) || 1), lastDay);
  return iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), d)));
}

/**
 * Periods from the later of the plan start and the member's join date, up to `through` (inclusive), one per
 * cadence step. Mirrors `private.welfare_period_starts` + `generate_welfare_contributions` in the database.
 */
export function contributionPeriods(plan: Pick<ContributionPlan, "cadence" | "day" | "startsOn">, joinedAt: string | null | undefined, through: string): ContributionPeriod[] {
  const cadence = isCadence(plan.cadence) ? plan.cadence : "monthly";
  const from = [plan.startsOn, joinedAt].filter((x): x is string => !!x).map(utc).sort((a, b) => b.getTime() - a.getTime())[0] ?? utc(through);
  const end = utc(through);
  const out: ContributionPeriod[] = [];
  let cursor = firstOfMonth(from);
  while (cursor <= end && out.length < 600) {
    const periodStart = iso(cursor);
    out.push({ periodStart, dueAt: contributionDueDate(periodStart, plan.day) });
    cursor = addMonths(cursor, MONTHS[cadence]);
  }
  return out;
}

export interface ContributionLike {
  id?: string;
  member_id: string;
  period_start: string;
  due_at: string;
  amount: number | string;
  status: ContributionStatus | string;
  paid_at?: string | null;
  paid_by_user_id?: string | null;
  paid_via?: string | null;
}

/** Periods a member still needs rows for (not yet in `existing`). */
export function contributionSchedule(plan: ContributionPlan, member: { id: string; joined_at?: string | null }, through: string, existing: ContributionLike[] = []): (ContributionPeriod & { memberId: string; amount: number })[] {
  const have = new Set(existing.filter((c) => c.member_id === member.id).map((c) => c.period_start.slice(0, 10)));
  return contributionPeriods(plan, member.joined_at, through)
    .filter((p) => !have.has(p.periodStart))
    .map((p) => ({ ...p, memberId: member.id, amount: Math.round(plan.amount * 100) / 100 }));
}

// ---------------------------------------------------------------------------
// Standing and arrears
// ---------------------------------------------------------------------------
export type StandingState = "paid_up" | "due" | "arrears" | "none";

export interface MemberStanding {
  memberId: string;
  state: StandingState;
  label: string;
  tone: "ok" | "wait" | "danger" | "neutral";
  /** Unpaid (due / failed) contributions whose due date has passed. */
  overdueCount: number;
  /** Total unpaid and overdue, GHS. */
  arrears: number;
  /** Unpaid but not yet due. */
  upcomingCount: number;
  paidCount: number;
  /** Next unpaid contribution (oldest first). */
  next: ContributionLike | null;
  lastPaidAt: string | null;
  /** Days the oldest unpaid contribution is overdue (0 when none). */
  daysOverdue: number;
}

const day = (d: string) => utc(d).getTime();
const num = (n: number | string) => Math.round((Number(n) || 0) * 100) / 100;

/** How one member stands with their contributions as of `now`. */
export function memberStanding(memberId: string, contributions: ContributionLike[], now: Date | string = new Date()): MemberStanding {
  const today = typeof now === "string" ? day(now) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const mine = contributions.filter((c) => c.member_id === memberId).sort((a, b) => a.period_start.localeCompare(b.period_start));
  const unpaid = mine.filter((c) => c.status === "due" || c.status === "failed");
  const overdue = unpaid.filter((c) => day(c.due_at) < today);
  const arrears = Math.round(overdue.reduce((s, c) => s + num(c.amount), 0) * 100) / 100;
  const paid = mine.filter((c) => c.status === "paid");
  const next = unpaid[0] ?? null;
  const daysOverdue = overdue[0] ? Math.max(0, Math.floor((today - day(overdue[0].due_at)) / 86_400_000)) : 0;
  const state: StandingState = overdue.length ? "arrears" : unpaid.length ? "due" : mine.length ? "paid_up" : "none";
  const meta: Record<StandingState, { label: string; tone: MemberStanding["tone"] }> = {
    paid_up: { label: "Paid up", tone: "ok" },
    due: { label: "Due soon", tone: "wait" },
    arrears: { label: `${overdue.length} overdue`, tone: "danger" },
    none: { label: "No contributions yet", tone: "neutral" },
  };
  return {
    memberId,
    state,
    label: meta[state].label,
    tone: meta[state].tone,
    overdueCount: overdue.length,
    arrears,
    upcomingCount: unpaid.length - overdue.length,
    paidCount: paid.length,
    next,
    lastPaidAt: paid.map((c) => c.paid_at ?? null).filter((x): x is string => !!x).sort().at(-1) ?? null,
    daysOverdue,
  };
}

export interface GroupContributionSummary {
  members: number;
  paidUp: number;
  dueSoon: number;
  inArrears: number;
  noSchedule: number;
  /** Total overdue across the group, GHS. */
  arrears: number;
  /** Collected (paid) this calendar month, GHS. */
  collectedThisPeriod: number;
  /** Due in the next `horizonDays` days (unpaid, not yet overdue). */
  upcoming: { count: number; amount: number; dueBy: string | null };
  standings: MemberStanding[];
}

/** The admin dashboard numbers: who is paid up, who is in arrears, what is coming. */
export function groupContributionSummary(memberIds: string[], contributions: ContributionLike[], now: Date | string = new Date(), horizonDays = 14): GroupContributionSummary {
  const nowDate = typeof now === "string" ? utc(now) : now;
  const today = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  const standings = memberIds.map((id) => memberStanding(id, contributions, nowDate));
  const monthKey = iso(nowDate).slice(0, 7);
  const horizon = today + horizonDays * 86_400_000;
  const upcomingRows = contributions.filter((c) => (c.status === "due" || c.status === "failed") && day(c.due_at) >= today && day(c.due_at) <= horizon);
  return {
    members: memberIds.length,
    paidUp: standings.filter((s) => s.state === "paid_up").length,
    dueSoon: standings.filter((s) => s.state === "due").length,
    inArrears: standings.filter((s) => s.state === "arrears").length,
    noSchedule: standings.filter((s) => s.state === "none").length,
    arrears: Math.round(standings.reduce((s, m) => s + m.arrears, 0) * 100) / 100,
    collectedThisPeriod: Math.round(contributions.filter((c) => c.status === "paid" && (c.paid_at ?? "").slice(0, 7) === monthKey).reduce((s, c) => s + num(c.amount), 0) * 100) / 100,
    upcoming: {
      count: upcomingRows.length,
      amount: Math.round(upcomingRows.reduce((s, c) => s + num(c.amount), 0) * 100) / 100,
      dueBy: upcomingRows.map((c) => c.due_at.slice(0, 10)).sort().at(-1) ?? null,
    },
    standings,
  };
}

// ---------------------------------------------------------------------------
// Sponsor allocation
// ---------------------------------------------------------------------------
export interface SponsorAllocation {
  /** Contributions to settle, oldest first per member. */
  contributions: ContributionLike[];
  /** Per member: what is settled. */
  byMember: { memberId: string; count: number; amount: number }[];
  /** Total in GHS (what the insurer receives). */
  totalGhs: number;
  /** Unpaid contributions left out (budget cap or member not selected). */
  leftOut: ContributionLike[];
}

/**
 * Which unpaid contributions a sponsor settles. Oldest debt first for each selected member; with `maxGhs` the
 * allocation stops before a contribution that would exceed the budget (never a partial contribution). The result
 * keeps one line per contribution so the payment records exactly who was paid for.
 */
export function allocateSponsorPayment(contributions: ContributionLike[], memberIds: string[], opts: { maxGhs?: number | null; periodsPerMember?: number | null } = {}): SponsorAllocation {
  const wanted = new Set(memberIds);
  const cap = typeof opts.maxGhs === "number" && opts.maxGhs >= 0 ? opts.maxGhs : null;
  const perMember = typeof opts.periodsPerMember === "number" && opts.periodsPerMember > 0 ? Math.floor(opts.periodsPerMember) : null;
  const unpaid = contributions.filter((c) => c.status === "due" || c.status === "failed").sort((a, b) => a.period_start.localeCompare(b.period_start) || a.member_id.localeCompare(b.member_id));
  const picked: ContributionLike[] = [];
  const leftOut: ContributionLike[] = [];
  const taken: Record<string, number> = {};
  let total = 0;
  for (const c of unpaid) {
    if (!wanted.has(c.member_id)) {
      leftOut.push(c);
      continue;
    }
    const amount = num(c.amount);
    const count = taken[c.member_id] ?? 0;
    if ((perMember !== null && count >= perMember) || (cap !== null && total + amount > cap + 1e-9)) {
      leftOut.push(c);
      continue;
    }
    picked.push(c);
    taken[c.member_id] = count + 1;
    total = Math.round((total + amount) * 100) / 100;
  }
  const byMember = memberIds.map((memberId) => {
    const rows = picked.filter((c) => c.member_id === memberId);
    return { memberId, count: rows.length, amount: Math.round(rows.reduce((s, c) => s + num(c.amount), 0) * 100) / 100 };
  });
  return { contributions: picked, byMember, totalGhs: total, leftOut };
}

/** "GH₵ 60.00 monthly per member" */
export function contributionPlanLabel(plan: Pick<ContributionPlan, "amount" | "cadence">): string {
  const cadence = isCadence(plan.cadence) ? plan.cadence : "monthly";
  return `GH₵ ${num(plan.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CADENCE_LABEL[cadence].toLowerCase()} per member`;
}

// ---------------------------------------------------------------------------
// Claims: document checklist for a funeral / welfare claim
// ---------------------------------------------------------------------------
export const WELFARE_CLAIM_KINDS = [
  { value: "death", label: "Death of a member (funeral benefit)" },
  { value: "death_of_dependant", label: "Death of a member's spouse, child or parent" },
  { value: "hospitalisation", label: "Hospital stay (welfare benefit)" },
  { value: "other_welfare", label: "Other welfare benefit set out in the group's rules" },
] as const;
export type WelfareClaimKind = (typeof WELFARE_CLAIM_KINDS)[number]["value"];
export const WELFARE_CLAIM_KIND_VALUES = WELFARE_CLAIM_KINDS.map((k) => k.value) as [WelfareClaimKind, ...WelfareClaimKind[]];

export interface ChecklistItem {
  key: string;
  label: string;
  documentKind: "id_document" | "medical" | "receipt" | "police_report" | "photo" | "other";
  optional?: boolean;
  hint?: string;
}

/**
 * Documents the insurer typically asks for. The group admin or beneficiary gathers them; the broker checks and
 * delivers; only the insurer decides. `accidental` adds the police report.
 */
export function funeralClaimChecklist(kind: WelfareClaimKind | string, opts: { accidental?: boolean; claimantIsBeneficiary?: boolean } = {}): ChecklistItem[] {
  const base: ChecklistItem[] = [{ key: "description", label: "What happened, when and where", documentKind: "other" }];
  const death: ChecklistItem[] = [
    { key: "death_certificate", label: "Death certificate (Births and Deaths Registry) or medical certificate of cause of death", documentKind: "other" },
    { key: "burial_permit", label: "Burial permit", documentKind: "other", optional: true },
    { key: "deceased_id", label: "Deceased's Ghana Card, passport or voter ID", documentKind: "id_document" },
    { key: "claimant_id", label: "Claimant's Ghana Card or other ID", documentKind: "id_document" },
    { key: "proof_of_relationship", label: "Proof of relationship to the deceased (marriage or birth certificate, affidavit)", documentKind: "other", hint: "Needed when the claimant is a beneficiary rather than the group admin." },
    { key: "membership_confirmation", label: "Group's confirmation that the member was enrolled and paid up", documentKind: "other", hint: "Covva prepares this from the enrolment and contribution records." },
  ];
  const hospital: ChecklistItem[] = [
    { key: "medical_report", label: "Medical report or discharge summary from the hospital", documentKind: "medical" },
    { key: "hospital_bills", label: "Hospital bills and receipts", documentKind: "receipt" },
    { key: "member_id", label: "Member's Ghana Card or other ID", documentKind: "id_document" },
  ];
  const other: ChecklistItem[] = [
    { key: "supporting", label: "Supporting documents for the benefit claimed under the group's rules", documentKind: "other" },
    { key: "member_id", label: "Member's Ghana Card or other ID", documentKind: "id_document" },
  ];
  let items: ChecklistItem[];
  switch (kind) {
    case "death":
      items = [...base, ...death.filter((i) => i.key !== "proof_of_relationship" || opts.claimantIsBeneficiary !== false)];
      break;
    case "death_of_dependant":
      items = [...base, ...death.map((i) => (i.key === "deceased_id" ? { ...i, label: "Deceased dependant's ID or birth certificate" } : i)), { key: "dependant_record", label: "The dependant appears on the member's beneficiary / dependant record", documentKind: "other", hint: "Checked by Covva from the group's records." }];
      break;
    case "hospitalisation":
      items = [...base, ...hospital];
      break;
    default:
      items = [...base, ...other];
  }
  if (opts.accidental) items.push({ key: "police_report", label: "Police report or extract (accidental death or injury)", documentKind: "police_report" });
  return items;
}

/** The `incident_type` recorded on the claim for each welfare claim kind. */
export function welfareIncidentType(kind: WelfareClaimKind | string, accidental = false): string {
  const k = (WELFARE_CLAIM_KIND_VALUES as readonly string[]).includes(kind) ? kind : "other_welfare";
  return accidental && (k === "death" || k === "death_of_dependant") ? `${k}_accident` : k;
}

// ---------------------------------------------------------------------------
// Bulk enrolment CSV
// ---------------------------------------------------------------------------
export interface WelfareMemberImportRow {
  row: number;
  full_name: string;
  phone?: string;
  email?: string;
  date_of_birth?: string;
  gender?: "female" | "male" | "other";
  ghana_card_last4?: string;
  beneficiary_name?: string;
  beneficiary_relationship?: WelfareRelationship;
  beneficiary_phone?: string;
}
export interface WelfareMemberImportResult {
  rows: WelfareMemberImportRow[];
  errors: CsvRowError[];
}

export const WELFARE_MEMBER_CSV_COLUMNS = ["full_name", "phone", "email", "date_of_birth", "gender", "ghana_card", "beneficiary_name", "beneficiary_relationship", "beneficiary_phone"] as const;
export const welfareMemberCsvTemplate =
  `${WELFARE_MEMBER_CSV_COLUMNS.join(",")}\n` +
  "Ama Mensah,0241234567,ama@example.com,1970-04-12,female,GHA-123456789-0,Kojo Mensah,spouse,0201234567\n" +
  "Yaw Boateng,0209876543,,1965-11-23,male,,Esi Boateng,child,\n";

const ALIASES: Record<string, string> = {
  "full name": "full_name", name: "full_name", "member name": "full_name", member: "full_name",
  phone: "phone", mobile: "phone", "phone number": "phone", telephone: "phone", momo: "phone",
  email: "email", "e mail": "email",
  "date of birth": "date_of_birth", dob: "date_of_birth", birthday: "date_of_birth",
  gender: "gender", sex: "gender",
  "ghana card": "ghana_card", "ghana card number": "ghana_card", "id number": "ghana_card", nia: "ghana_card",
  "beneficiary name": "beneficiary_name", beneficiary: "beneficiary_name", "next of kin": "beneficiary_name", nok: "beneficiary_name",
  "beneficiary relationship": "beneficiary_relationship", relationship: "beneficiary_relationship", "nok relationship": "beneficiary_relationship",
  "beneficiary phone": "beneficiary_phone", "nok phone": "beneficiary_phone",
};
const normHeader = (h: string) => h.trim().toLowerCase().replace(/[_\s-]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();

function normDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let out: string | null = null;
  if (m) out = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!out && m) out = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  if (!out) return null;
  const d = new Date(`${out}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === out ? out : null;
}

export function parseWelfareMemberCsv(text: string, opts: { today?: Date; max?: number } = {}): WelfareMemberImportResult {
  const today = opts.today ?? new Date();
  const max = opts.max ?? 2000;
  const lines = parseCsvLines(text);
  const errors: CsvRowError[] = [];
  const rows: WelfareMemberImportRow[] = [];
  if (!lines.length) return { rows, errors: [{ row: 1, message: "The file is empty." }] };
  const header = lines[0]!.map((h) => ALIASES[normHeader(h)] ?? null);
  if (!header.includes("full_name")) return { rows, errors: [{ row: 1, message: "The first row must name the columns and include a full name column." }] };
  const col = (cells: string[], key: string) => {
    const i = header.indexOf(key);
    return i >= 0 ? (cells[i] ?? "").trim() : "";
  };
  const phones = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!;
    if (!cells.some((c) => c.trim() !== "")) continue;
    const rowNo = i + 1;
    if (rows.length >= max) {
      errors.push({ row: rowNo, message: `Only the first ${max} members were read. Split the file.` });
      break;
    }
    const name = col(cells, "full_name");
    if (name.length < 2 || name.length > 160) {
      errors.push({ row: rowNo, message: "Full name is missing." });
      continue;
    }
    const r: WelfareMemberImportRow = { row: rowNo, full_name: name.replace(/\s+/g, " ") };
    const phoneRaw = col(cells, "phone");
    if (phoneRaw) {
      const p = normalisePhone(phoneRaw);
      if (!/^\+233\d{9}$/.test(p)) {
        errors.push({ row: rowNo, message: `Phone "${phoneRaw}" is not a Ghana number.` });
        continue;
      }
      const seen = phones.get(p);
      if (seen) {
        errors.push({ row: rowNo, message: `Phone ${p} is already used on row ${seen}.` });
        continue;
      }
      phones.set(p, rowNo);
      r.phone = p;
    }
    const email = col(cells, "email").toLowerCase();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ row: rowNo, message: `Email "${email}" is not valid.` });
        continue;
      }
      r.email = email;
    }
    const dob = col(cells, "date_of_birth");
    if (dob) {
      const d = normDate(dob);
      if (!d || d > today.toISOString().slice(0, 10)) {
        errors.push({ row: rowNo, message: `Date of birth "${dob}" is not a valid past date (use YYYY-MM-DD).` });
        continue;
      }
      r.date_of_birth = d;
    }
    const g = col(cells, "gender").toLowerCase();
    if (g) {
      const gender = g.startsWith("f") ? "female" : g.startsWith("m") ? "male" : g === "other" || g === "o" ? "other" : null;
      if (!gender) {
        errors.push({ row: rowNo, message: `Gender "${g}" should be female, male or other.` });
        continue;
      }
      r.gender = gender;
    }
    const card = col(cells, "ghana_card");
    if (card) {
      const last4 = ghanaCardLast4(card);
      if (!last4) {
        errors.push({ row: rowNo, message: `Ghana Card "${card}" is not in the GHA-XXXXXXXXX-X format.` });
        continue;
      }
      r.ghana_card_last4 = last4;
    }
    const bName = col(cells, "beneficiary_name");
    if (bName) {
      r.beneficiary_name = bName.replace(/\s+/g, " ").slice(0, 160);
      const rel = col(cells, "beneficiary_relationship").toLowerCase().replace(/[^a-z]/g, "");
      const relationship = (WELFARE_RELATIONSHIP_VALUES as readonly string[]).includes(rel) ? (rel as WelfareRelationship) : rel === "wife" || rel === "husband" ? "spouse" : rel === "son" || rel === "daughter" ? "child" : rel === "mother" || rel === "father" ? "parent" : rel === "brother" || rel === "sister" ? "sibling" : "other";
      r.beneficiary_relationship = relationship;
      const bPhone = col(cells, "beneficiary_phone");
      if (bPhone) {
        const p = normalisePhone(bPhone);
        if (!/^\+233\d{9}$/.test(p)) {
          errors.push({ row: rowNo, message: `Beneficiary phone "${bPhone}" is not a Ghana number.` });
          continue;
        }
        r.beneficiary_phone = p;
      }
    }
    rows.push(r);
  }
  return { rows, errors };
}

/** Join link for a group's invitation token. */
export function welfareJoinPath(token: string): string {
  return `/account/groups/join/${encodeURIComponent(token)}`;
}
/** Sponsor invitation link. */
export function welfareSponsorPath(token: string): string {
  return `/account/groups/sponsor/${encodeURIComponent(token)}`;
}
