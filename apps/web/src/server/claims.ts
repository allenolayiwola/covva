import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLAIM_DISCLAIMER,
  CLAIM_JOB_STATUS,
  CLAIM_STATUS,
  canMessage,
  scoreFraudFlags,
  validateClaimVideo,
  type ClaimJobInput,
  type FraudStatus,
  type ServicePartnerKind,
  type UpdateClaimJobInput,
} from "@im/core";
import { STORAGE_BUCKETS, type Database, type Enum, type Insert, type Json, type Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { ApiError, forbidden, invalid, notFound, rule } from "@/server/api-auth";
import { log } from "@/server/log";
import { notify, notifyOrg, type NotifyInput } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";

/** Evidence the insurer typically needs, by category and incident. Shown as a checklist; the insurer decides. */
export interface EvidenceItem { key: string; label: string; documentKind?: Enum<"document_kind">; optional?: boolean }

const BASE: EvidenceItem[] = [{ key: "description", label: "A clear description of what happened, when and where" }];

const BY_CATEGORY: Record<string, EvidenceItem[]> = {
  motor: [
    { key: "photos", label: "Photos of the damage and the scene", documentKind: "photo" },
    { key: "drivers_licence", label: "Driver's licence of the person driving", documentKind: "drivers_licence" },
    { key: "vehicle_registration", label: "Vehicle registration document", documentKind: "vehicle_registration" },
    { key: "repair_estimate", label: "Repair estimate or invoice", documentKind: "invoice" },
  ],
  travel: [
    { key: "medical_report", label: "Medical report or receipts", documentKind: "medical" },
    { key: "receipts", label: "Receipts for costs you are claiming", documentKind: "receipt" },
    { key: "id", label: "Passport or ID", documentKind: "id_document" },
  ],
  "personal-accident": [
    { key: "medical_report", label: "Medical report from the treating doctor or hospital", documentKind: "medical" },
    { key: "hospital_bills", label: "Hospital bills and receipts", documentKind: "receipt" },
    { key: "id", label: "Ghana Card or other ID", documentKind: "id_document" },
  ],
  home: [
    { key: "photos", label: "Photos of the damage or the point of entry", documentKind: "photo" },
    { key: "proof_of_ownership", label: "Receipts or proof of ownership for items claimed", documentKind: "receipt" },
    { key: "repair_quote", label: "Repair or replacement quotation", documentKind: "invoice" },
  ],
  health: [
    { key: "medical_report", label: "Medical report and diagnosis", documentKind: "medical" },
    { key: "bills", label: "Itemised hospital bills", documentKind: "invoice" },
  ],
  "life-funeral": [
    { key: "death_certificate", label: "Death certificate", documentKind: "other" },
    { key: "claimant_id", label: "Claimant's Ghana Card or ID", documentKind: "id_document" },
    { key: "burial_permit", label: "Burial permit (if available)", documentKind: "other", optional: true },
  ],
  "sme-property": [
    { key: "photos", label: "Photos of the damage or loss", documentKind: "photo" },
    { key: "stock_records", label: "Stock records or invoices for items lost", documentKind: "invoice" },
    { key: "repair_quote", label: "Repair or replacement quotation", documentKind: "invoice" },
  ],
  liability: [
    { key: "claim_letter", label: "The letter or claim you received from the third party", documentKind: "other" },
    { key: "correspondence", label: "Any correspondence about the incident", documentKind: "other", optional: true },
  ],
  "marine-cargo": [
    { key: "bill_of_lading", label: "Bill of lading or waybill", documentKind: "other" },
    { key: "commercial_invoice", label: "Commercial invoice", documentKind: "invoice" },
    { key: "survey_report", label: "Survey report or photos of the damaged goods", documentKind: "photo" },
  ],
};

const POLICE_INCIDENTS = /theft|burglar|stolen|robbery|accident|collision|hit|fire|vandal|break.?in/i;

export function requiredEvidence(categorySlug: string, incidentType: string): EvidenceItem[] {
  const items = [...BASE, ...(BY_CATEGORY[categorySlug] ?? [{ key: "supporting", label: "Supporting documents or photos", documentKind: "claim_evidence" as const }])];
  if (POLICE_INCIDENTS.test(incidentType)) {
    items.push({ key: "police_report", label: "Police report or extract", documentKind: "police_report", optional: /accident|collision/i.test(incidentType) && categorySlug !== "motor" });
  }
  return items;
}

// ===========================================================================
// Claims completion (Roadmap Phase 2): reporting, thread, info requests, video,
// fraud checks, partner network jobs. Every function takes the caller's client
// (RLS applies) and never decides a claim — only the insurer does, elsewhere.
// ===========================================================================
export type Db = SupabaseClient<Database>;

export type ClaimParty = Pick<Row<"claims">, "id" | "reference" | "status" | "customer_id" | "broker_org_id" | "insurer_org_id" | "policy_id"> & { reported_by_user_id?: string | null };

const CLAIM_PARTY_COLS = "id, reference, status, customer_id, broker_org_id, insurer_org_id, policy_id";
const CLOSED: Enum<"claim_status">[] = ["withdrawn", "closed", "paid", "rejected"];

async function loadClaim(db: Db, claimId: string): Promise<ClaimParty> {
  const { data, error } = await db.from("claims").select(CLAIM_PARTY_COLS).eq("id", claimId).maybeSingle();
  if (error) throw new ApiError("internal_error", "We couldn't load that claim.", error.message);
  if (!data) throw notFound("Claim not found.");
  return data as ClaimParty;
}

/** Which party the caller is on this claim (through their memberships; RLS already proved access). */
export async function partyFor(db: Db, claim: ClaimParty, userId: string): Promise<Enum<"party"> | "sponsor"> {
  if (claim.customer_id === userId) return "customer";
  const { data } = await db.from("memberships").select("org_id, org:organizations!memberships_org_id_fkey(type)").eq("user_id", userId).eq("active", true);
  const rows = (data ?? []) as unknown as { org_id: string; org: { type: string } | null }[];
  if (rows.some((m) => m.org_id === claim.insurer_org_id)) return "insurer";
  if (claim.broker_org_id && rows.some((m) => m.org_id === claim.broker_org_id)) return "broker";
  if (rows.some((m) => m.org?.type === "platform")) return "platform";
  return "sponsor";
}

// ---------------------------------------------------------------------------
// Notifications to every party on a claim
// ---------------------------------------------------------------------------
interface PartyMessage {
  kind: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  /** Channels for the customer (defaults by kind in notify()). */
  customerChannels?: NotifyInput["channels"];
}

/**
 * Fan out to the customer, the sponsor who reported on their behalf (diaspora), the broker of record and the
 * insurer's claims team. `except` skips the author. The sponsor leg is optional at runtime: the diaspora stream
 * ships `apps/web/src/server/diaspora-notify.ts` exporting `notifyPolicyParties({ policyId, kind, title, body, link,
 * data, excludeUserIds })`, which notifies the sponsor(s) of a policy. It is loaded lazily through a dynamic
 * import of this directory so this module compiles before that file exists; any failure is swallowed.
 */
export async function notifyClaimParties(
  claim: ClaimParty,
  msg: PartyMessage,
  opts: { except?: { userId?: string | null; orgId?: string | null }; customer?: boolean; broker?: boolean; insurer?: boolean; insurerRoles?: string[] } = {},
): Promise<void> {
  const customer = opts.customer !== false && claim.customer_id !== opts.except?.userId;
  const tasks: Promise<unknown>[] = [];
  if (customer) {
    tasks.push(notify({ userId: claim.customer_id, kind: msg.kind, title: msg.title, body: msg.body, link: `/account/claims/${claim.id}`, data: { claim_id: claim.id, ...msg.data }, channels: msg.customerChannels }));
  }
  if (opts.broker !== false && claim.broker_org_id && claim.broker_org_id !== opts.except?.orgId) {
    tasks.push(notifyOrg(claim.broker_org_id, { kind: msg.kind, title: msg.title, body: msg.body, link: `/partner/claims/${claim.id}`, data: { claim_id: claim.id, ...msg.data } }));
  }
  if (opts.insurer !== false && claim.insurer_org_id !== opts.except?.orgId) {
    tasks.push(notifyOrg(claim.insurer_org_id, { kind: msg.kind, title: msg.title, body: msg.body, link: `/partner/claims/${claim.id}`, data: { claim_id: claim.id, ...msg.data } }, opts.insurerRoles ?? ["owner", "admin", "claims_officer"]));
  }
  tasks.push(notifySponsor(claim, msg, opts.except?.userId ?? null));
  await Promise.all(tasks.map((t) => t.catch((err) => log.warn("claim.notify_failed", { claimId: claim.id, err }))));
}

async function notifySponsor(claim: ClaimParty, msg: PartyMessage, exceptUserId: string | null): Promise<void> {
  try {
    const name = "diaspora-notify";
    const mod = (await import(`./${name}`)) as { notifyPolicyParties?: (input: Record<string, unknown>) => Promise<unknown> };
    if (typeof mod.notifyPolicyParties !== "function") return;
    await mod.notifyPolicyParties({
      policyId: claim.policy_id,
      claimId: claim.id,
      kind: msg.kind,
      title: msg.title,
      body: msg.body,
      link: `/account/claims/${claim.id}`,
      data: { claim_id: claim.id, ...msg.data },
      excludeUserIds: [claim.customer_id, exceptUserId].filter(Boolean),
    });
  } catch {
    // diaspora-notify.ts not shipped yet (or failed): the sponsor leg is best effort.
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
export interface ClaimEvidenceFile {
  path: string;
  name: string;
  mime?: string | null;
  size?: number | null;
  kind?: Enum<"document_kind"> | null;
  durationSeconds?: number | null;
}

export interface CreateClaimInput {
  policyId: string;
  /** The policyholder (claim owner). */
  customerId: string;
  incidentType: string;
  incidentAt: string | Date;
  /** Free text, or `{ lat, lng, address }` from the phone's location. */
  location?: string | { lat?: number | null; lng?: number | null; accuracy?: number | null; address?: string | null } | null;
  description: string;
  amountClaimed?: number | null;
  thirdParties?: Json;
  /**
   * Sponsor reporting on behalf of a beneficiary (diaspora proxy claims). Stored in `claims.reported_by_user_id`
   * when that column exists (added by the diaspora migration); silently dropped otherwise.
   */
  reportedByUserId?: string | null;
  /** Diaspora proxy consent reference, stored in `claims.proxy_consent_id` when the column exists. */
  proxyConsentId?: string | null;
  /** An already-uploaded police report (documents.id owned by the customer) to link to the claim. */
  policeReportDocumentId?: string | null;
  /** Files already in the documents bucket under the customer's folder (web/mobile direct uploads). */
  evidence?: ClaimEvidenceFile[];
  /** Override the stored checklist (the customer web form uses its own labels). */
  requiredEvidence?: unknown[];
  source?: "web" | "mobile" | "api" | "whatsapp";
}

export interface CreateClaimResult {
  claim: Pick<Row<"claims">, "id" | "reference" | "status" | "incident_type" | "incident_at" | "reported_at" | "created_at" | "policy_id">;
  policy: { id: string; insurer_org_id: string; broker_org_id: string | null; policy_number: string | null; internal_reference: string; categorySlug: string };
  requiredEvidence: EvidenceItem[];
  warnings: string[];
  disclaimer: string;
}

function kindForMime(mime: string | null | undefined): Enum<"document_kind"> {
  if (!mime) return "claim_evidence";
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "claim_video";
  return "claim_evidence";
}

/**
 * Report a claim on a policy: validates the policy, inserts the claim (status `reported`; the DB trigger runs
 * fraud checks), links evidence and the police report, notifies every party and emits webhooks.
 * Reporting is not approval — only the insurer decides, elsewhere.
 */
export async function createClaim(db: Db, input: CreateClaimInput): Promise<CreateClaimResult> {
  const { data: policy, error: pErr } = await db
    .from("policies")
    .select("id, customer_id, status, insurer_org_id, broker_org_id, external_source, cover_start, cover_end, internal_reference, policy_number, category:product_categories(slug)")
    .eq("id", input.policyId)
    .maybeSingle();
  if (pErr) throw new ApiError("internal_error", "We couldn't load that policy.", pErr.message);
  if (!policy) throw notFound("Policy not found.");
  if (policy.customer_id !== input.customerId) throw rule("Only the policyholder can report a claim here.");
  if (policy.external_source || !policy.insurer_org_id) throw rule("For a policy you added yourself, contact the insurer that issued it to make a claim.");
  if (policy.status === "pending_issuance") throw rule("This policy hasn't been issued by the insurer yet, so there is no cover to claim against. Contact your broker.");
  if (policy.status === "cancelled") throw rule("This policy was cancelled. Contact your broker if you think this is wrong.");

  const incidentAt = input.incidentAt instanceof Date ? input.incidentAt : new Date(input.incidentAt);
  if (Number.isNaN(incidentAt.getTime())) throw invalid("Enter the date the incident happened.");
  if (incidentAt.getTime() > Date.now() + 86_400_000) throw invalid("The incident date can't be in the future.");

  const slug = (policy.category as unknown as { slug: string } | null)?.slug ?? "other";
  const evidence = requiredEvidence(slug, input.incidentType);
  const locationText = typeof input.location === "string" ? input.location : input.location?.address ?? null;
  const gps = input.location && typeof input.location === "object" && (input.location.lat != null || input.location.lng != null)
    ? ({ lat: input.location.lat ?? null, lng: input.location.lng ?? null, accuracy: input.location.accuracy ?? null } as Json)
    : null;

  const row: Insert<"claims"> & Record<string, unknown> = {
    policy_id: policy.id,
    customer_id: input.customerId,
    insurer_org_id: policy.insurer_org_id,
    broker_org_id: policy.broker_org_id,
    status: "reported", // customers may only draft, report or withdraw (DB trigger)
    incident_type: input.incidentType,
    incident_at: incidentAt.toISOString(),
    location: locationText?.slice(0, 300) || null,
    location_gps: gps,
    description: input.description,
    amount_claimed: input.amountClaimed ?? null,
    third_parties: (input.thirdParties ?? []) as Json,
    required_evidence: (input.requiredEvidence ?? evidence) as unknown as Json,
  };
  if (input.reportedByUserId) row.reported_by_user_id = input.reportedByUserId;
  if (input.proxyConsentId) row.proxy_consent_id = input.proxyConsentId;

  const select = "id, reference, status, incident_type, incident_at, reported_at, created_at, policy_id";
  let inserted = await db.from("claims").insert(row as Insert<"claims">).select(select).single();
  if (inserted.error && inserted.error.code === "42703" && (row.reported_by_user_id || row.proxy_consent_id)) {
    // Diaspora columns not migrated yet on this database: report without them rather than fail.
    delete row.reported_by_user_id;
    delete row.proxy_consent_id;
    inserted = await db.from("claims").insert(row as Insert<"claims">).select(select).single();
  }
  if (inserted.error || !inserted.data) {
    const e = inserted.error;
    if (e?.code === "P0001") throw rule(e.message);
    if (e?.code === "42501") throw forbidden("You can't report a claim on this policy.");
    throw new ApiError("internal_error", "We couldn't report your claim. Please try again.", e?.message);
  }
  const claim = inserted.data;
  const uploader = input.reportedByUserId ?? input.customerId;

  for (const f of input.evidence ?? []) {
    if (!f.path.startsWith(`${input.customerId}/`) || f.path.includes("..")) continue;
    const { error } = await db.from("documents").insert({
      owner_id: input.customerId,
      uploaded_by: uploader,
      uploaded_by_party: "customer",
      claim_id: claim.id,
      policy_id: policy.id,
      kind: f.kind ?? kindForMime(f.mime),
      storage_path: f.path,
      file_name: f.name.slice(0, 255),
      mime_type: f.mime || null,
      size_bytes: f.size || null,
      duration_seconds: f.durationSeconds ?? null,
    });
    if (error) log.warn("claim.evidence_link_failed", { claimId: claim.id, path: f.path, err: error });
  }
  if (input.policeReportDocumentId) {
    const { error } = await db.from("documents").update({ claim_id: claim.id, kind: "police_report" }).eq("id", input.policeReportDocumentId).eq("owner_id", input.customerId);
    if (error) log.warn("claim.police_report_link_failed", { claimId: claim.id, err: error });
  }

  const warnings: string[] = [];
  const day = incidentAt.toISOString().slice(0, 10);
  if (policy.cover_start && policy.cover_end && (day < policy.cover_start || day > policy.cover_end)) {
    warnings.push("The incident date looks outside the cover period. Your broker will check this with you.");
  }

  const party: ClaimParty = { id: claim.id, reference: claim.reference, status: claim.status, customer_id: input.customerId, broker_org_id: policy.broker_org_id, insurer_org_id: policy.insurer_org_id, policy_id: policy.id };
  const incident = input.incidentType.replace(/_/g, " ");
  await Promise.all([
    notify({ userId: input.customerId, kind: "claim.reported", title: `Claim ${claim.reference} reported to your broker`, body: CLAIM_DISCLAIMER, link: `/account/claims/${claim.id}`, data: { claim_id: claim.id }, channels: ["in_app", "email", "push"] }).catch(() => {}),
    notifyClaimParties(party, {
      kind: "claim.reported",
      title: `Claim ${claim.reference} reported`,
      body: `${incident} on ${policy.policy_number ?? policy.internal_reference}. ${input.description.slice(0, 120)}`,
      data: { incident_type: input.incidentType },
    }, { customer: false, except: { userId: input.customerId } }),
  ]);
  const reported = { claim_id: claim.id, reference: claim.reference, policy_id: policy.id, status: "reported", incident_type: input.incidentType };
  await emitEvent(policy.broker_org_id, "claim.reported", reported);
  await emitEvent(policy.insurer_org_id, "claim.reported", reported);

  return {
    claim,
    policy: { id: policy.id, insurer_org_id: policy.insurer_org_id, broker_org_id: policy.broker_org_id, policy_number: policy.policy_number, internal_reference: policy.internal_reference, categorySlug: slug },
    requiredEvidence: evidence,
    warnings,
    disclaimer: CLAIM_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------
export interface ClaimAttachment { storage_path?: string; document_id?: string; name: string }

export async function addClaimMessage(
  db: Db,
  input: { claimId: string; userId: string; body: string; attachments?: ClaimAttachment[]; internal?: boolean },
): Promise<Row<"claim_messages">> {
  const claim = await loadClaim(db, input.claimId);
  const party = await partyFor(db, claim, input.userId);
  if (!canMessage(party === "sponsor" ? "sponsor" : party, claim)) throw rule(`This claim is ${CLAIM_STATUS[claim.status].label.toLowerCase()}; messages are closed. Contact your broker if you have new information.`);
  if (input.internal && (party === "customer" || party === "sponsor")) throw forbidden("Only the broker, insurer or platform staff can write internal notes.");
  const attachments = (input.attachments ?? []).filter((a) => a.name && (a.storage_path || a.document_id)).slice(0, 10);
  const { data, error } = await db
    .from("claim_messages")
    .insert({ claim_id: claim.id, author_id: input.userId, body: input.body.trim().slice(0, 4000), attachments: attachments as unknown as Json, internal: !!input.internal })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "P0001") throw rule(error.message);
    if (error?.code === "42501") throw forbidden("You can't post in this claim thread.");
    throw new ApiError("internal_error", "We couldn't send that message.", error?.message);
  }
  const preview = data.body.length > 160 ? `${data.body.slice(0, 157)}…` : data.body;
  const who = data.author_party === "customer" ? "The customer" : data.author_party === "broker" ? "The broker" : data.author_party === "insurer" ? "The insurer" : "Platform support";
  const authorOrg = party === "insurer" ? claim.insurer_org_id : party === "broker" ? claim.broker_org_id : null;
  await notifyClaimParties(
    claim,
    { kind: data.internal ? "claim.note" : "claim.message", title: data.internal ? `Internal note on claim ${claim.reference}` : `${who} wrote on claim ${claim.reference}`, body: preview, data: { message_id: data.id }, customerChannels: ["in_app", "push", "email"] },
    { customer: !data.internal, except: { userId: input.userId, orgId: authorOrg } },
  );
  return data;
}

export async function listClaimMessages(db: Db, claimId: string, opts: { limit?: number; before?: string } = {}): Promise<Row<"claim_messages">[]> {
  let q = db.from("claim_messages").select("*").eq("claim_id", claimId).order("created_at", { ascending: true }).limit(opts.limit ?? 100);
  if (opts.before) q = q.lt("created_at", opts.before);
  const { data, error } = await q;
  if (error) throw new ApiError("internal_error", "We couldn't load the thread.", error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Information requests
// ---------------------------------------------------------------------------
export async function requestClaimInfo(
  db: Db,
  input: { claimId: string; userId: string; kind?: "document" | "information" | "inspection"; requestedParty?: "customer" | "broker"; message: string; dueAt?: string | null; setStatus?: boolean },
): Promise<Row<"claim_info_requests">> {
  const claim = await loadClaim(db, input.claimId);
  const party = await partyFor(db, claim, input.userId);
  if (party === "customer" || party === "sponsor") throw forbidden("Information requests are raised by the broker or insurer.");
  if (CLOSED.includes(claim.status)) throw rule(`This claim is ${CLAIM_STATUS[claim.status].label.toLowerCase()}.`);
  const requestedParty = input.requestedParty ?? "customer";
  if (requestedParty === "broker" && party === "broker") throw rule("Ask the insurer or the customer, not your own organisation.");
  const { data, error } = await db
    .from("claim_info_requests")
    .insert({ claim_id: claim.id, requested_by: input.userId, requested_party: requestedParty, kind: input.kind ?? "document", message: input.message.trim().slice(0, 2000), due_at: input.dueAt ?? null })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "P0001") throw rule(error.message);
    if (error?.code === "42501") throw forbidden("You can't raise information requests on this claim.");
    throw new ApiError("internal_error", "We couldn't save that request.", error?.message);
  }
  if (input.setStatus && party === "insurer" && ["acknowledged", "under_assessment", "delivered_to_insurer"].includes(claim.status)) {
    const { error: sErr } = await db.from("claims").update({ status: "info_requested" }).eq("id", claim.id);
    if (sErr) log.warn("claim.info_requested_status_failed", { claimId: claim.id, err: sErr });
    else {
      const changed = { claim_id: claim.id, reference: claim.reference, from_status: claim.status, status: "info_requested" };
      await emitEvent(claim.broker_org_id, "claim.status_changed", changed);
      await emitEvent(claim.insurer_org_id, "claim.status_changed", changed);
    }
  }
  const from = party === "insurer" ? "The insurer" : party === "broker" ? "Your broker" : "Platform support";
  const what = data.kind === "inspection" ? "wants to arrange an inspection" : data.kind === "information" ? "needs more information" : "needs a document";
  const due = data.due_at ? ` by ${new Date(data.due_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  await notifyClaimParties(
    claim,
    { kind: "claim.info_requested", title: `Claim ${claim.reference}: ${from} ${what}${due}`, body: data.message, data: { info_request_id: data.id, kind: data.kind }, customerChannels: ["in_app", "push", "email", "sms"] },
    { customer: requestedParty === "customer", broker: true, insurer: party !== "insurer", except: { userId: input.userId, orgId: party === "insurer" ? claim.insurer_org_id : claim.broker_org_id } },
  );
  return data;
}

export async function fulfilInfoRequest(
  db: Db,
  input: { requestId: string; userId: string; documentId?: string | null; response?: string | null },
): Promise<Row<"claim_info_requests">> {
  const { data: req, error: rErr } = await db.from("claim_info_requests").select("*").eq("id", input.requestId).maybeSingle();
  if (rErr) throw new ApiError("internal_error", "We couldn't load that request.", rErr.message);
  if (!req) throw notFound("Information request not found.");
  if (req.fulfilled_at) throw rule("This request has already been answered.");
  if (!input.documentId && !input.response?.trim()) throw invalid("Attach a document or write a response.");
  const claim = await loadClaim(db, req.claim_id);
  if (input.documentId) {
    const { data: doc } = await db.from("documents").select("id, claim_id").eq("id", input.documentId).maybeSingle();
    if (!doc) throw notFound("Document not found.");
    if (doc.claim_id !== claim.id) {
      const { error } = await db.from("documents").update({ claim_id: claim.id }).eq("id", doc.id);
      if (error) throw forbidden("That document can't be linked to this claim.");
    }
  }
  const { data, error } = await db
    .from("claim_info_requests")
    .update({ fulfilled_at: new Date().toISOString(), fulfilled_by: input.userId, document_id: input.documentId ?? null, response: input.response?.trim().slice(0, 2000) || null })
    .eq("id", req.id)
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "P0001") throw rule(error.message);
    throw new ApiError("internal_error", "We couldn't record your response.", error?.message);
  }
  const party = await partyFor(db, claim, input.userId);
  const who = party === "customer" || party === "sponsor" ? "The customer" : party === "broker" ? "The broker" : "The insurer";
  const msg: PartyMessage = { kind: "claim.info_fulfilled", title: `Claim ${claim.reference}: ${who} answered the information request`, body: data.response ?? (data.document_id ? "A document was attached." : undefined), data: { info_request_id: data.id } };
  if (data.requested_by) await notify({ userId: data.requested_by, ...msg, link: `/partner/claims/${claim.id}` }).catch(() => {});
  await notifyClaimParties(claim, msg, { customer: false, except: { userId: input.userId, orgId: party === "insurer" ? claim.insurer_org_id : party === "broker" ? claim.broker_org_id : null }, insurer: data.requested_by_party !== "insurer" || !data.requested_by, broker: data.requested_by_party !== "broker" || !data.requested_by });
  return data;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------
const VIDEO_EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/**
 * Store a short claim video (≤ 90 s, ≤ 50 MB; MP4/WebM/QuickTime) under
 * `documents/{customerId}/claims/{claimId}/video-{uuid}.{ext}` and record it as a `claim_video` document.
 * The duration comes from the device (`<video>` metadata / the mobile picker); a thumbnail is optional and not generated here.
 */
export async function uploadClaimVideo(
  db: Db,
  input: { claimId: string; userId: string; fileName: string; mimeType: string; bytes: Uint8Array; durationSeconds?: number | null; caption?: string | null },
): Promise<Row<"documents">> {
  const claim = await loadClaim(db, input.claimId);
  if (CLOSED.includes(claim.status)) throw rule(`This claim is ${CLAIM_STATUS[claim.status].label.toLowerCase()}; no more evidence can be added.`);
  const mime = input.mimeType.split(";")[0]!.trim().toLowerCase();
  const check = validateClaimVideo({ mimeType: mime, sizeBytes: input.bytes.byteLength, durationSeconds: input.durationSeconds ?? null });
  if (!check.ok) throw invalid(check.reason);
  const party = await partyFor(db, claim, input.userId);
  const ext = VIDEO_EXT[mime] ?? "mp4";
  const path = `${claim.customer_id}/claims/${claim.id}/video-${crypto.randomUUID()}.${ext}`;
  const upload = await db.storage.from(STORAGE_BUCKETS.documents).upload(path, input.bytes, { contentType: mime, upsert: false });
  if (upload.error) throw new ApiError("forbidden", "You can't upload a video to this claim.", { storage: upload.error.message });
  const { data, error } = await db
    .from("documents")
    .insert({
      owner_id: claim.customer_id,
      uploaded_by: input.userId,
      uploaded_by_party: party === "sponsor" ? "customer" : party,
      claim_id: claim.id,
      policy_id: claim.policy_id,
      kind: "claim_video",
      storage_path: path,
      file_name: (input.caption?.trim() ? `${input.caption.trim().slice(0, 120)}.${ext}` : input.fileName).slice(0, 255),
      mime_type: mime,
      size_bytes: input.bytes.byteLength,
      duration_seconds: input.durationSeconds != null ? Math.round(input.durationSeconds) : null,
    })
    .select("*")
    .single();
  if (error || !data) {
    await db.storage.from(STORAGE_BUCKETS.documents).remove([path]).catch(() => {});
    throw new ApiError("internal_error", "We couldn't save the video.", error?.message);
  }
  await notifyClaimParties(claim, { kind: "claim.evidence", title: `Video added to claim ${claim.reference}`, body: data.file_name, data: { document_id: data.id } }, { customer: party !== "customer" && party !== "sponsor", except: { userId: input.userId } });
  return data;
}

// ---------------------------------------------------------------------------
// Fraud checks
// ---------------------------------------------------------------------------
export interface FraudSummary { claim_id: string; score: number | null; status: FraudStatus | null; open_flags: number }

/**
 * Re-run the database fraud checks (service role) — e.g. after new evidence or on demand from the claims desk —
 * and alert the insurer's claims officers when the claim lands in review. Flags never reach customers.
 */
export async function runFraudChecks(claimId: string, opts: { notify?: boolean } = {}): Promise<FraudSummary> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("run_claim_fraud_checks", { p_claim_id: claimId });
  if (error) throw new ApiError("internal_error", "Fraud checks failed.", error.message);
  const summary = (data ?? {}) as unknown as FraudSummary;
  if (opts.notify !== false && summary.status === "review") {
    const { data: claim } = await svc.from("claims").select("id, reference, insurer_org_id").eq("id", claimId).maybeSingle();
    if (claim) {
      await notifyOrg(claim.insurer_org_id, {
        kind: "claim.fraud_review",
        title: `Claim ${claim.reference} needs a fraud review`,
        body: `${summary.open_flags} indicator${summary.open_flags === 1 ? "" : "s"} raised (score ${summary.score}). Review the flags before deciding the claim.`,
        link: `/partner/claims/${claim.id}`,
        data: { claim_id: claim.id, fraud_score: summary.score },
        channels: ["in_app", "email", "push"],
      }, ["owner", "admin", "claims_officer"]).catch(() => {});
    }
  }
  return summary;
}

export async function reviewFraudFlag(db: Db, input: { flagId: string; userId: string; status: "cleared" | "confirmed" | "open"; note?: string | null }): Promise<{ flag: Row<"claim_fraud_flags">; summary: ReturnType<typeof scoreFraudFlags> }> {
  const { data, error } = await db
    .from("claim_fraud_flags")
    .update({ status: input.status, review_note: input.note?.trim().slice(0, 1000) || null, reviewed_by: input.userId })
    .eq("id", input.flagId)
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "42501") throw forbidden("Only the insurer's claims team or platform staff review fraud flags.");
    throw new ApiError("internal_error", "We couldn't update that flag.", error?.message);
  }
  const { data: all } = await db.from("claim_fraud_flags").select("kind, status, score").eq("claim_id", data.claim_id);
  return { flag: data, summary: scoreFraudFlags(all ?? []) };
}

// ---------------------------------------------------------------------------
// Partner network
// ---------------------------------------------------------------------------
export type ServicePartnerRow = Row<"service_partners">;

export async function listServicePartners(
  db: Db,
  opts: { kind?: ServicePartnerKind | ServicePartnerKind[]; region?: string | null; insurerOrgId?: string | null; q?: string | null; limit?: number } = {},
): Promise<(ServicePartnerRow & { directBilling: boolean })[]> {
  let q = db.from("service_partners").select("*").eq("status", "approved").order("region").order("name").limit(opts.limit ?? 100);
  if (opts.kind) q = Array.isArray(opts.kind) ? q.in("kind", opts.kind) : q.eq("kind", opts.kind);
  if (opts.region) q = q.ilike("region", `%${opts.region.replace(/[%_]/g, "")}%`);
  if (opts.q) q = q.ilike("name", `%${opts.q.replace(/[%_]/g, "")}%`);
  const { data, error } = await q;
  if (error) throw new ApiError("internal_error", "We couldn't load the partner directory.", error.message);
  const rows = (data ?? []).map((p) => ({ ...p, directBilling: !!opts.insurerOrgId && (p.direct_billing_insurer_ids ?? []).includes(opts.insurerOrgId) }));
  // Partners near the customer's region first, then those that direct-bill the insurer.
  return rows.sort((a, b) => Number(b.directBilling) - Number(a.directBilling) || a.name.localeCompare(b.name));
}

export async function createClaimJob(db: Db, input: ClaimJobInput & { claimId: string; userId: string }): Promise<Row<"claim_jobs"> & { partner: Pick<ServicePartnerRow, "id" | "name" | "kind" | "phone" | "address" | "region"> }> {
  const claim = await loadClaim(db, input.claimId);
  const party = await partyFor(db, claim, input.userId);
  if (party === "customer" || party === "sponsor") throw forbidden("Your broker or insurer arranges repairs and services for a claim.");
  if (CLOSED.includes(claim.status)) throw rule(`This claim is ${CLAIM_STATUS[claim.status].label.toLowerCase()}.`);
  const { data: partner } = await db.from("service_partners").select("id, name, kind, phone, address, region, status, direct_billing_insurer_ids").eq("id", input.servicePartnerId).maybeSingle();
  if (!partner || partner.status !== "approved") throw notFound("That service partner isn't in the approved directory.");
  const canDirectBill = (partner.direct_billing_insurer_ids ?? []).includes(claim.insurer_org_id);
  if (input.directBilling && !canDirectBill) throw rule(`${partner.name} does not direct-bill this insurer. The customer pays and claims the cost back, or choose a partner that does.`);
  const { data, error } = await db
    .from("claim_jobs")
    .insert({
      claim_id: claim.id,
      service_partner_id: partner.id,
      kind: input.kind,
      direct_billing: !!input.directBilling,
      estimate: input.estimate ?? null,
      scheduled_for: input.scheduledFor ?? null,
      notes: input.notes?.trim() || null,
      created_by: input.userId,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "P0001") throw rule(error.message);
    if (error?.code === "42501") throw forbidden("You can't arrange jobs on this claim.");
    throw new ApiError("internal_error", "We couldn't create that job.", error?.message);
  }
  const kindLabel = input.kind === "repair" ? "Repair" : input.kind === "towing" ? "Towing" : input.kind === "treatment" ? "Treatment" : input.kind === "assessment" ? "Assessment" : "Service";
  await notifyClaimParties(
    claim,
    {
      kind: "claim.job",
      title: `${kindLabel} arranged with ${partner.name} for claim ${claim.reference}`,
      body: `${[partner.address, partner.phone ? `Call ${partner.phone}` : null].filter(Boolean).join(" · ")}${data.direct_billing ? " · Direct billing — you don't pay upfront." : ""}`,
      data: { job_id: data.id, partner_id: partner.id },
      customerChannels: ["in_app", "push", "email", "sms"],
    },
    { except: { userId: input.userId, orgId: party === "insurer" ? claim.insurer_org_id : claim.broker_org_id } },
  );
  return { ...data, partner: { id: partner.id, name: partner.name, kind: partner.kind, phone: partner.phone, address: partner.address, region: partner.region } };
}

export async function updateClaimJob(db: Db, input: UpdateClaimJobInput & { userId: string }): Promise<Row<"claim_jobs">> {
  const { data: job } = await db.from("claim_jobs").select("id, claim_id, status, direct_billing").eq("id", input.jobId).maybeSingle();
  if (!job) throw notFound("Job not found.");
  const claim = await loadClaim(db, job.claim_id);
  const party = await partyFor(db, claim, input.userId);
  if (party === "customer" || party === "sponsor") throw forbidden("Your broker or insurer tracks this job.");
  if (["completed", "cancelled"].includes(job.status) && input.status && input.status !== job.status) throw rule(`This job is already ${CLAIM_JOB_STATUS[job.status as keyof typeof CLAIM_JOB_STATUS].label.toLowerCase()}.`);
  const patch: Partial<Row<"claim_jobs">> = {};
  if (input.status) patch.status = input.status;
  if (input.estimate !== undefined) patch.estimate = input.estimate;
  if (input.invoiceDocumentId !== undefined) patch.invoice_document_id = input.invoiceDocumentId;
  if (input.scheduledFor !== undefined) patch.scheduled_for = input.scheduledFor;
  if (input.directBilling !== undefined) patch.direct_billing = input.directBilling;
  if (input.notes !== undefined) patch.notes = input.notes.trim() || null;
  const { data, error } = await db.from("claim_jobs").update(patch).eq("id", job.id).select("*").single();
  if (error || !data) {
    if (error?.code === "P0001") throw rule(error.message);
    if (error?.code === "42501") throw forbidden("You can't update this job.");
    throw new ApiError("internal_error", "We couldn't update that job.", error?.message);
  }
  if (input.status && input.status !== job.status) {
    const { data: partner } = await db.from("service_partners").select("name").eq("id", data.service_partner_id).maybeSingle();
    await notifyClaimParties(
      claim,
      { kind: "claim.job", title: `Claim ${claim.reference}: ${partner?.name ?? "service partner"} job ${CLAIM_JOB_STATUS[input.status].label.toLowerCase()}`, body: data.notes ?? undefined, data: { job_id: data.id, status: data.status }, customerChannels: ["in_app", "push"] },
      { except: { userId: input.userId, orgId: party === "insurer" ? claim.insurer_org_id : claim.broker_org_id } },
    );
  }
  return data;
}

export async function listClaimJobs(db: Db, claimId: string): Promise<(Row<"claim_jobs"> & { partner: Pick<ServicePartnerRow, "id" | "name" | "kind" | "phone" | "address" | "region" | "email"> | null })[]> {
  const { data, error } = await db
    .from("claim_jobs")
    .select("*, partner:service_partners(id, name, kind, phone, address, region, email)")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: true });
  if (error) throw new ApiError("internal_error", "We couldn't load the jobs.", error.message);
  return (data ?? []) as unknown as (Row<"claim_jobs"> & { partner: Pick<ServicePartnerRow, "id" | "name" | "kind" | "phone" | "address" | "region" | "email"> | null })[];
}
