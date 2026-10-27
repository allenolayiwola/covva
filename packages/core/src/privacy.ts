import type { Enum } from "@im/db";
import type { StatusMeta } from "./status";

/**
 * Act 843 (Ghana Data Protection Act 2012) data-subject requests and retention rules.
 *
 * Pure logic shared by the customer area, the admin console, the retention cron and the tests:
 *   - request types, statuses and the allowed transitions (mirrored by private.privacy_transition_allowed in
 *     supabase/migrations/20261031100100_data_subject_requests.sql — keep the two in sync);
 *   - the due date (configurable, default 30 days — the statutory deadline is still to be confirmed with counsel);
 *   - retention periods per data class and the plan the cron job sends to public.run_privacy_retention();
 *   - what a deletion scrubs vs retains, in words a customer understands;
 *   - the personal-data export: its shape and the redaction rules.
 */

export type PrivacyRequestType = Enum<"privacy_request_type">;
export type PrivacyRequestStatus = Enum<"privacy_request_status">;

export interface PrivacyTypeMeta {
  /** Staff-facing label. */
  label: string;
  /** What the customer picks ("Get a copy of my data"). */
  customerLabel: string;
  /** One line under the choice. */
  description: string;
  /** What happens next, in plain words. */
  whatHappens: string;
  /** A note is required (and what to ask for). */
  noteRequired: boolean;
  notePrompt: string;
}

export const PRIVACY_REQUEST_TYPES: Record<PrivacyRequestType, PrivacyTypeMeta> = {
  access: {
    label: "Access / export",
    customerLabel: "Get a copy of my data",
    description: "A file with your profile, requests, quotes, policies, payments, claims, consents, family details and messages.",
    whatHappens: "We check it's you, then prepare a download. You'll get a notification when it's ready; the link works for 7 days.",
    noteRequired: false,
    notePrompt: "Anything in particular you're looking for? (optional)",
  },
  correction: {
    label: "Correction",
    customerLabel: "Correct something that's wrong",
    description: "Fix details we hold that are wrong or out of date.",
    whatHappens: "We check it's you, make the change (or ask your insurer or broker to), and tell you what we changed.",
    noteRequired: true,
    notePrompt: "What is wrong, and what should it say?",
  },
  deletion: {
    label: "Deletion",
    customerLabel: "Delete my account and data",
    description: "Close your account and erase what we don't have to keep.",
    whatHappens:
      "We check it's you, then erase your contact details, marketing choices, chats and drafts. Insurance records (policies, claims, payments and their documents) have to be kept by law, so we keep those securely and tell you exactly what was kept.",
    noteRequired: false,
    notePrompt: "Anything we should know? (optional)",
  },
  objection: {
    label: "Objection",
    customerLabel: "Object to how my data is used",
    description: "Ask us to stop using your data for a particular purpose.",
    whatHappens: "We check it's you, review your objection and tell you what we've stopped, or why we can't.",
    noteRequired: true,
    notePrompt: "Which use of your data do you object to?",
  },
  marketing_opt_out: {
    label: "Marketing opt-out",
    customerLabel: "Stop marketing messages",
    description: "No more tips or offers by email, SMS or WhatsApp.",
    whatHappens: "This happens straight away. You'll still get service messages about your cover, quotes and claims.",
    noteRequired: false,
    notePrompt: "Anything we should know? (optional)",
  },
};

/** The request types in the order they are offered to customers. */
export const PRIVACY_REQUEST_TYPE_LIST = ["access", "correction", "deletion", "objection", "marketing_opt_out"] as const satisfies readonly PrivacyRequestType[];

export const PRIVACY_STATUS: Record<PrivacyRequestStatus, StatusMeta> = {
  submitted: { label: "Received", tone: "info", customerHint: "We've received your request and will check it's you first." },
  identity_verified: { label: "Identity confirmed", tone: "info", customerHint: "We've confirmed it's you and are working on your request." },
  approved: { label: "Approved", tone: "info", customerHint: "Your request has been approved and is being carried out." },
  export_ready: { label: "Ready to download", tone: "ok", customerHint: "Your data is ready. Download it before the link expires." },
  fulfilled: { label: "Completed", tone: "ok", customerHint: "We've done what you asked." },
  refused: { label: "Not carried out", tone: "danger", customerHint: "We couldn't carry out this request. The reason is below." },
  closed: { label: "Closed", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral", customerHint: "You withdrew this request." },
};

/** Statuses that count as "open" (one open request per type per person; overdue checks). */
export const OPEN_PRIVACY_STATUSES: readonly PrivacyRequestStatus[] = ["submitted", "identity_verified", "approved", "export_ready"];
/** Statuses that are still waiting on Covva (the due date applies). */
export const PENDING_PRIVACY_STATUSES: readonly PrivacyRequestStatus[] = ["submitted", "identity_verified", "approved"];

interface Transition {
  to: PrivacyRequestStatus;
  /** Only these request types may take the transition (all types when omitted). */
  types?: readonly PrivacyRequestType[];
  /** Types that may NOT take it. */
  notTypes?: readonly PrivacyRequestType[];
}

/** Allowed status transitions (mirrors private.privacy_transition_allowed). */
export const PRIVACY_TRANSITIONS: Record<PrivacyRequestStatus, readonly Transition[]> = {
  submitted: [{ to: "identity_verified" }, { to: "refused" }, { to: "withdrawn" }, { to: "fulfilled", types: ["marketing_opt_out"] }],
  identity_verified: [
    { to: "approved", notTypes: ["marketing_opt_out"] },
    { to: "export_ready", types: ["access"] },
    { to: "refused" },
    { to: "withdrawn" },
  ],
  approved: [{ to: "export_ready", types: ["access"] }, { to: "fulfilled", types: ["correction", "deletion", "objection"] }, { to: "withdrawn" }],
  export_ready: [{ to: "closed" }],
  fulfilled: [{ to: "closed" }],
  refused: [{ to: "closed" }],
  closed: [],
  withdrawn: [],
};

export function canTransitionPrivacy(type: PrivacyRequestType, from: PrivacyRequestStatus, to: PrivacyRequestStatus): boolean {
  return PRIVACY_TRANSITIONS[from].some((t) => t.to === to && (!t.types || t.types.includes(type)) && !(t.notTypes ?? []).includes(type));
}

export function isTerminalPrivacyStatus(s: PrivacyRequestStatus): boolean {
  return PRIVACY_TRANSITIONS[s].length === 0;
}

/** Staff actions in the admin console; each maps to one RPC call. */
export type PrivacyAction = "verify_identity" | "approve" | "refuse" | "generate_export" | "fulfil" | "fulfil_deletion" | "close";

/** Which staff actions are available for a request right now (drives the admin detail page). */
export function privacyActionsFor(type: PrivacyRequestType, status: PrivacyRequestStatus): PrivacyAction[] {
  const out: PrivacyAction[] = [];
  if (status === "submitted" && type !== "marketing_opt_out") out.push("verify_identity");
  if (canTransitionPrivacy(type, status, "approved") && type !== "access") out.push("approve");
  if (type === "access" && (status === "identity_verified" || status === "approved" || status === "export_ready")) out.push("generate_export");
  if (status === "approved" && (type === "correction" || type === "objection")) out.push("fulfil");
  if (status === "approved" && type === "deletion") out.push("fulfil_deletion");
  if (canTransitionPrivacy(type, status, "refused")) out.push("refuse");
  if (canTransitionPrivacy(type, status, "closed")) out.push("close");
  return out;
}

/** Customer may withdraw until the request is carried out. */
export function canWithdrawPrivacy(status: PrivacyRequestStatus): boolean {
  return status === "submitted" || status === "identity_verified" || status === "approved";
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------
/** Default days to answer. To confirm with counsel; configurable via platform_settings.privacy_request_due_days. */
export const DEFAULT_PRIVACY_DUE_DAYS = 30;
export const MIN_PRIVACY_DUE_DAYS = 1;
export const MAX_PRIVACY_DUE_DAYS = 90;
const DAY_MS = 86_400_000;

/** Reads the setting (number or numeric string); falls back to 30 and clamps to 1–90 (same as private.int_setting). */
export function normalisePrivacyDueDays(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,6}$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_PRIVACY_DUE_DAYS;
  return Math.min(MAX_PRIVACY_DUE_DAYS, Math.max(MIN_PRIVACY_DUE_DAYS, n));
}

export function privacyDueDate(createdAt: Date | string, days: number = DEFAULT_PRIVACY_DUE_DAYS): Date {
  const start = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return new Date(start.getTime() + normalisePrivacyDueDays(days) * DAY_MS);
}

export interface PrivacyDeadline {
  overdue: boolean;
  /** Whole days left (negative when overdue); null when the request no longer waits on Covva. */
  daysLeft: number | null;
  label: string;
}

/** Deadline state for display and the admin "overdue" filter. Only pending requests can be overdue. */
export function privacyDeadline(req: { status: PrivacyRequestStatus; due_at: string }, now: Date = new Date()): PrivacyDeadline {
  if (!PENDING_PRIVACY_STATUSES.includes(req.status)) return { overdue: false, daysLeft: null, label: "—" };
  const ms = Date.parse(req.due_at) - now.getTime();
  const daysLeft = Math.ceil(ms / DAY_MS);
  if (ms < 0) {
    const late = Math.max(1, Math.floor(-ms / DAY_MS));
    return { overdue: true, daysLeft: -late, label: `Overdue by ${late} day${late === 1 ? "" : "s"}` };
  }
  if (daysLeft <= 1) return { overdue: false, daysLeft, label: "Due today" };
  return { overdue: false, daysLeft, label: `${daysLeft} days left` };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------
export type RetentionClass =
  | "unconverted_leads"
  | "ai_chat_logs"
  | "whatsapp_transcripts"
  | "abandoned_drafts"
  | "anonymous_needs_assessments"
  | "ussd_sessions"
  | "stale_device_tokens"
  | "policy_explainer_logs"
  | "telematics_trips";

export interface RetentionRule {
  class: RetentionClass;
  label: string;
  /** Default period in days (overridable in platform_settings.privacy_retention.periods). */
  days: number;
  action: "scrub" | "delete";
  /** Table(s) touched. */
  tables: string[];
  description: string;
}

/**
 * Default retention periods. These are working defaults for data Covva does not need to keep; the durations are to be
 * confirmed with counsel (see docs/PRIVACY_REQUESTS.md). E2E / demo data is always excluded by the database function.
 * Insurance records (policies, claims, payments, issued documents, ledger, audit) are NOT here: they are retained.
 */
export const RETENTION_RULES: readonly RetentionRule[] = [
  { class: "unconverted_leads", label: "Unconverted enquiries", days: 730, action: "scrub", tables: ["leads"], description: "Customer enquiries and callback requests that never became an account and are not being worked: name, email, phone, message and notes erased." },
  { class: "ai_chat_logs", label: "AI assistant chats", days: 365, action: "delete", tables: ["ai_threads"], description: "AI assistant conversations with no activity for the period are deleted." },
  { class: "whatsapp_transcripts", label: "WhatsApp chat transcripts", days: 365, action: "scrub", tables: ["wa_messages"], description: "Message text in WhatsApp conversations with no activity for the period is erased. Contacts and opt-outs are kept." },
  { class: "abandoned_drafts", label: "Abandoned quote drafts", days: 180, action: "scrub", tables: ["requests"], description: "Quote requests left as drafts: the answers are erased and the draft cancelled." },
  { class: "anonymous_needs_assessments", label: "Anonymous needs checks", days: 180, action: "scrub", tables: ["needs_assessments"], description: "Answers to the 'what cover do I need' questions from people who never signed in." },
  { class: "ussd_sessions", label: "USSD sessions", days: 90, action: "delete", tables: ["ussd_sessions"], description: "Phone number and menu state of finished USSD sessions." },
  { class: "policy_explainer_logs", label: "Policy explainer questions", days: 180, action: "delete", tables: ["policy_explainer_logs"], description: "Questions asked about a policy and the answers shown, kept for quality review only." },
  { class: "stale_device_tokens", label: "Unused push tokens", days: 400, action: "delete", tables: ["device_tokens"], description: "Push notification tokens of devices not seen for the period." },
  { class: "telematics_trips", label: "Driving trip summaries", days: 395, action: "delete", tables: ["telematics_trips"], description: "Trip summaries (times, distance, speed band, harsh events, night share, phone use) from consented driving scoring older than the period, and all trips of enrolments withdrawn more than 30 days ago. Monthly scores stay with the policy." },
];

/** Shortest period the database accepts (guards against a mistyped override). */
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;
/** How long a generated export stays downloadable (platform_settings.privacy_export_ttl_days). */
export const PRIVACY_EXPORT_TTL_DAYS = 7;

export type RetentionMode = "dry_run" | "enforce";

export interface RetentionConfig {
  mode: RetentionMode;
  periods: Record<RetentionClass, number>;
  /** Overrides that were ignored, and why. */
  warnings: string[];
}

const RULE_BY_CLASS = new Map(RETENTION_RULES.map((r) => [r.class, r]));

export function isRetentionClass(v: string): v is RetentionClass {
  return RULE_BY_CLASS.has(v as RetentionClass);
}

/**
 * Parses platform_settings.privacy_retention ({ mode, periods }). Anything unexpected falls back to the safe
 * default: mode dry_run, default periods. Overrides shorter than 30 days, longer than 10 years or for unknown classes
 * are ignored with a warning.
 */
export function normaliseRetentionConfig(raw: unknown): RetentionConfig {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mode: RetentionMode = obj.mode === "enforce" ? "enforce" : "dry_run";
  const periods = Object.fromEntries(RETENTION_RULES.map((r) => [r.class, r.days])) as Record<RetentionClass, number>;
  const warnings: string[] = [];
  const overrides = obj.periods && typeof obj.periods === "object" && !Array.isArray(obj.periods) ? (obj.periods as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(overrides)) {
    if (!isRetentionClass(k)) {
      warnings.push(`Unknown data class "${k}" ignored`);
      continue;
    }
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < MIN_RETENTION_DAYS || n > MAX_RETENTION_DAYS) {
      warnings.push(`Period for ${k} must be ${MIN_RETENTION_DAYS}–${MAX_RETENTION_DAYS} days; kept ${periods[k]}`);
      continue;
    }
    periods[k] = n;
  }
  return { mode, periods, warnings };
}

export interface RetentionPlanItem {
  class: RetentionClass;
  days: number;
  /** ISO timestamp: rows older than this are due. */
  cutoff: string;
}

/** The plan sent to public.run_privacy_retention(p_plan). One item per rule, in rule order. */
export function retentionPlan(config: Pick<RetentionConfig, "periods">, now: Date = new Date()): RetentionPlanItem[] {
  return RETENTION_RULES.map((r) => {
    const days = config.periods[r.class] ?? r.days;
    return { class: r.class, days, cutoff: new Date(now.getTime() - days * DAY_MS).toISOString() };
  });
}

/** Dry run when the URL asks for it OR the platform setting is not yet "enforce". */
export function retentionDryRun(config: Pick<RetentionConfig, "mode">, requested?: string | null): boolean {
  const r = (requested ?? "").trim().toLowerCase();
  if (r === "1" || r === "true" || r === "yes") return true;
  return config.mode !== "enforce";
}

// ---------------------------------------------------------------------------
// Deletion: what is scrubbed and what is retained (customer copy + docs)
// ---------------------------------------------------------------------------
export interface ScopeEntry {
  table: string;
  /** Customer-facing name (retained records). */
  label?: string;
  what: string;
  reason: string;
}

/** Data a fulfilled deletion erases or scrubs (private.anonymise_subject). */
export const DELETION_SCRUBBED: readonly ScopeEntry[] = [
  { table: "profiles", what: "Email, phone, date of birth, Ghana Card number, region, city, avatar, time zone, preferred name; notifications and WhatsApp switched off. The name is erased too when there are no insurance records to keep.", reason: "Contact and profile details are not needed once the account is closed." },
  { table: "consents (marketing, AI help)", what: "Device details (IP address, browser) removed; a final 'withdrawn' entry recorded.", reason: "Optional consents end with the account." },
  { table: "leads", what: "Name, email, phone, organisation, message and notes of enquiries matching the email or phone.", reason: "Marketing enquiries are not insurance records." },
  { table: "ai_threads / ai_usage", what: "AI assistant chats deleted; usage rows detached from the person (costs only).", reason: "Chat transcripts are not needed." },
  { table: "policy_explainer_logs", what: "Questions asked about a policy and the answers shown, deleted. Cached plain-words summaries follow the policy.", reason: "Kept for quality review only." },
  { table: "wa_messages / wa_contacts", what: "WhatsApp message text erased; contact opted out and unlinked (the number is kept only so we never message it again).", reason: "Chat transcripts are not needed; the opt-out must be honoured." },
  { table: "requests / claims (drafts)", what: "Unsent quote drafts and draft claims: answers erased, draft cancelled or withdrawn.", reason: "Never sent to an insurer or broker." },
  { table: "needs_assessments", what: "Answers to the cover questions.", reason: "Only used to suggest cover." },
  { table: "notifications / device_tokens", what: "In-app notifications and push tokens deleted.", reason: "Delivery data for a closed account." },
  { table: "voice_notes", what: "Voice notes not attached to a claim deleted (and their audio files).", reason: "Not part of an insurance record." },
  { table: "ussd_sessions", what: "USSD sessions with the person's number deleted.", reason: "Session data only." },
  { table: "payment_methods / sponsor_subscriptions", what: "Saved cards revoked and their provider tokens removed; recurring sponsor payments cancelled.", reason: "No further payments will be taken." },
  { table: "quote_shares / referral_links", what: "Shared quote links expired; referral links disabled.", reason: "Links would otherwise keep working." },
  { table: "beneficiaries / households", what: "Family members not on any policy, request or sponsorship deleted; household names cleared.", reason: "Not needed for any retained record." },
  { table: "privacy_requests (exports)", what: "Earlier data-export files deleted.", reason: "Copies of personal data." },
  { table: "telematics_trips / telematics_enrolments", what: "Driving trip summaries deleted; driving-score enrolments withdrawn and device details removed. Monthly scores stay with the policy they priced.", reason: "Trip data is only needed to calculate scores; consent ends with the account." },
];

/** Records kept after a deletion, and why (see docs/PRIVACY_REQUESTS.md — durations to confirm with counsel). */
export const DELETION_RETAINED: readonly ScopeEntry[] = [
  { table: "policies, quotes, applications, submitted requests", label: "Policies, quotes and applications", what: "Kept as they are.", reason: "Insurance contracts and the advice/placement record must be kept for the insurer, the broker and the NIC." },
  { table: "claims, claim events, claim messages", label: "Claims", what: "Kept as they are.", reason: "Claims records must be kept by law and may be needed for future claims or disputes." },
  { table: "payments, payment splits, ledger entries, instalments", label: "Payments", what: "Kept as they are.", reason: "Financial and tax records must be kept." },
  { table: "documents", label: "Policy documents and evidence", what: "Kept as they are (schedules, certificates, receipts, evidence).", reason: "Issued documents and evidence belong to the insurance record." },
  { table: "request messages, complaints", label: "Messages with your broker or insurer, and complaints", what: "Kept as they are.", reason: "Correspondence about advice, cover and complaints is part of the regulated record." },
  { table: "kyc_verifications", label: "Identity checks", what: "Kept as they are.", reason: "Identity checks must be kept under anti-money-laundering rules." },
  { table: "consents (terms, privacy, data sharing)", label: "Your agreement to our terms and data sharing", what: "Kept as they are.", reason: "Evidence of the lawful basis for the records we keep." },
  { table: "audit_events", what: "Never changed (hash-chained). Entries written during the deletion record which fields changed, not their values.", reason: "Tamper-evident audit trail." },
  { table: "privacy_requests", what: "Kept, with what was erased and retained.", reason: "Evidence that the request was honoured." },
];

const RETAINED_LABELS: Record<string, [string, string]> = {
  policies: ["policy", "policies"],
  claims: ["claim", "claims"],
  payments: ["payment record", "payment records"],
  requests: ["quote request", "quote requests"],
  applications: ["application", "applications"],
  documents: ["document", "documents"],
  complaints: ["complaint", "complaints"],
  kyc_verifications: ["identity check", "identity checks"],
  messages: ["message with your broker or insurer", "messages with your broker or insurer"],
  consents: ["consent record", "consent records"],
  beneficiaries_on_policies: ["family member on a policy", "family members on policies"],
};

/** "2 policies", "1 claim" … for the counts in anonymisation_summary.retained (zero counts left out). */
export function describeRetainedRecords(retained: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  for (const [key, [one, many]] of Object.entries(RETAINED_LABELS)) {
    const n = Number(retained?.[key] ?? 0);
    if (Number.isFinite(n) && n > 0) out.push(`${n} ${n === 1 ? one : many}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export const PRIVACY_EXPORT_FORMAT = "covva.personal-data-export";
export const PRIVACY_EXPORT_VERSION = 1;

export type ExportSection =
  | "profile"
  | "privacy_requests"
  | "consents"
  | "requests"
  | "quotes"
  | "applications"
  | "policies"
  | "payments"
  | "claims"
  | "claim_events"
  | "complaints"
  | "documents"
  | "households"
  | "beneficiaries"
  | "sponsorships"
  | "messages"
  | "claim_messages"
  | "whatsapp_messages"
  | "ai_threads"
  | "notifications"
  | "kyc_verifications"
  | "payment_methods"
  | "voice_notes"
  | "needs_assessments"
  | "policy_explainer"
  | "loyalty_discounts"
  | "telematics"
  | "telematics_trips";

export const EXPORT_SECTIONS: readonly { key: ExportSection; label: string }[] = [
  { key: "profile", label: "Your profile" },
  { key: "privacy_requests", label: "Your privacy requests" },
  { key: "consents", label: "Consents you gave or withdrew" },
  { key: "requests", label: "Quote and service requests" },
  { key: "quotes", label: "Quotes" },
  { key: "applications", label: "Applications" },
  { key: "policies", label: "Policies" },
  { key: "payments", label: "Payments (metadata)" },
  { key: "claims", label: "Claims" },
  { key: "claim_events", label: "Claim timeline" },
  { key: "complaints", label: "Complaints" },
  { key: "documents", label: "Documents (file details)" },
  { key: "households", label: "Households" },
  { key: "beneficiaries", label: "Family members you added" },
  { key: "sponsorships", label: "Cover you pay for others" },
  { key: "messages", label: "Messages about your requests" },
  { key: "claim_messages", label: "Messages about your claims" },
  { key: "whatsapp_messages", label: "WhatsApp messages" },
  { key: "ai_threads", label: "AI assistant chats" },
  { key: "policy_explainer", label: "Questions about your policies" },
  { key: "notifications", label: "Notifications" },
  { key: "kyc_verifications", label: "Identity checks" },
  { key: "payment_methods", label: "Saved cards" },
  { key: "voice_notes", label: "Voice notes (transcripts)" },
  { key: "needs_assessments", label: "Cover questions you answered" },
  { key: "loyalty_discounts", label: "Discounts applied to your quotes" },
  { key: "telematics", label: "Driving score enrolments and monthly scores" },
  { key: "telematics_trips", label: "Driving trip summaries" },
];

/** Never exported: secrets, tokens, provider internals, hash chains, storage internals, staff identities. */
export const EXPORT_DROP_KEYS: ReadonlySet<string> = new Set([
  "raw_event", "authorization_url", "idempotency_key", "settlement_subaccount", "provider_token_ref", "provider_customer_ref",
  "consent_code_hash", "code_hash", "token", "token_hash", "secret", "risk_fingerprint", "checksum", "hash", "prev_hash",
  "storage_path", "bucket", "export_path", "export_sha256", "ai_extraction", "fraud_score", "fraud_status", "internal_note",
  // Staff / partner user ids (the people are named by organisation instead).
  "assigned_to", "assigned_user_id", "reviewed_by", "decided_by", "decision_by", "prepared_by", "issued_by", "verified_by",
  "reconciled_by", "closed_by", "identity_verified_by", "resolved_by", "submitted_by", "approved_by", "responded_by", "requested_by",
  // Message / event authors: the *_party column says who wrote it (you, your broker, the insurer, Covva).
  "sender_id", "author_id", "actor_id", "sender_user_id", "uploaded_by",
]);

/** Sections exported through an allow-list (only these columns). */
const EXPORT_ALLOW: Partial<Record<ExportSection, readonly string[]>> = {
  payments: ["id", "request_id", "policy_id", "amount", "currency", "status", "channel", "provider", "provider_reference", "paid_at", "failure_reason", "created_at"],
  documents: ["id", "kind", "file_name", "mime_type", "size_bytes", "request_id", "policy_id", "claim_id", "uploaded_by_party", "created_at"],
  kyc_verifications: ["id", "method", "status", "provider", "created_at", "reviewed_at", "checked_at"],
  payment_methods: ["id", "psp", "brand", "last4", "exp_month", "exp_year", "billing_country", "currency", "is_default", "status", "created_at"],
  notifications: ["id", "kind", "title", "body", "link", "read_at", "created_at"],
  voice_notes: ["id", "purpose", "request_id", "claim_id", "duration_seconds", "transcript", "transcript_language", "created_at"],
  policy_explainer: ["id", "policy_id", "question", "classification", "outcome", "answer_text", "handed_off_at", "created_at"],
  telematics: ["id", "kind", "policy_id", "enrolment_id", "status", "device_label", "consent_version", "enrolled_at", "withdrawn_at", "period", "score", "factors", "trips", "distance_km", "final", "computed_at", "created_at"],
  telematics_trips: ["id", "trip_id", "policy_id", "started_at", "ended_at", "distance_km", "max_speed_band", "harsh_brake_count", "harsh_accel_count", "night_share", "phone_use", "created_at"],
};

export type ExportRow = Record<string, unknown>;

/**
 * Redacts one row for the export, or returns null when the row must not be exported at all
 * (internal notes, staff-only timeline entries).
 */
export function redactExportRow(section: ExportSection, row: ExportRow): ExportRow | null {
  if (row.internal === true) return null;
  if (row.visible_to_customer === false) return null;
  const allow = EXPORT_ALLOW[section];
  const out: ExportRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (allow ? !allow.includes(k) : EXPORT_DROP_KEYS.has(k)) continue;
    if (k === "internal" || k === "visible_to_customer") continue;
    out[k] = v === undefined ? null : v;
  }
  return out;
}

export interface PrivacyExportInput {
  subjectId: string;
  reference: string;
  requestId: string;
  generatedAt: Date;
  sections: Partial<Record<ExportSection, ExportRow[] | ExportRow | null>>;
}

export interface PrivacyExport {
  format: typeof PRIVACY_EXPORT_FORMAT;
  version: typeof PRIVACY_EXPORT_VERSION;
  generated_at: string;
  reference: string;
  request_id: string;
  subject_id: string;
  about: string;
  not_included: string[];
  counts: Record<ExportSection, number>;
  sections: Record<ExportSection, { label: string; records: ExportRow[] }>;
}

export const EXPORT_ABOUT =
  "This file contains the personal data Covva holds about you, as at the time shown. Covva is a technology platform: the insurers and brokers who quoted, arranged or issued your cover keep their own records, so ask them directly for a copy of those.";

export const EXPORT_NOT_INCLUDED = [
  "Internal notes written by brokers, insurers or Covva staff.",
  "Security data such as passwords, sign-in tokens, payment provider tokens and checksums.",
  "The names of individual staff members (organisations are shown instead).",
  "The contents of documents and photos: they are listed here and you can download them from your account.",
];

/** Assembles the export JSON from raw rows (one call per request; sections in a fixed order). */
export function buildPrivacyExport(input: PrivacyExportInput): PrivacyExport {
  const sections = {} as PrivacyExport["sections"];
  const counts = {} as PrivacyExport["counts"];
  for (const { key, label } of EXPORT_SECTIONS) {
    const raw = input.sections[key];
    const rows = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    const records = rows.map((r) => redactExportRow(key, r)).filter((r): r is ExportRow => r !== null);
    sections[key] = { label, records };
    counts[key] = records.length;
  }
  return {
    format: PRIVACY_EXPORT_FORMAT,
    version: PRIVACY_EXPORT_VERSION,
    generated_at: input.generatedAt.toISOString(),
    reference: input.reference,
    request_id: input.requestId,
    subject_id: input.subjectId,
    about: EXPORT_ABOUT,
    not_included: [...EXPORT_NOT_INCLUDED],
    counts,
    sections,
  };
}

/** Storage path inside the private documents bucket; must match the check in public.record_privacy_export(). */
export function privacyExportPath(userId: string, reference: string, at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const ref = reference.replace(/[^A-Za-z0-9-]/g, "");
  return `privacy-exports/${userId}/${ref}-${stamp}.json`;
}

/** Download file name shown to the customer. */
export function privacyExportFileName(reference: string): string {
  return `covva-my-data-${reference.replace(/[^A-Za-z0-9-]/g, "")}.json`;
}
