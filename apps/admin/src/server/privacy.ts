import "server-only";
import { createHash } from "node:crypto";
import { buildPrivacyExport, privacyExportPath, type ExportRow, type ExportSection } from "@im/core";
import type { createServiceClient } from "@/lib/supabase/server";

/**
 * Act 843 export assembly for the admin console. Rows are read with the service client (the export spans tables the
 * staff session cannot read in full, e.g. a customer's AI chats), shaped and redacted by @im/core
 * buildPrivacyExport(), and uploaded to the PRIVATE documents bucket under privacy-exports/<user>/… — a prefix
 * customers cannot sign themselves. The customer downloads it through the web app's authenticated route only.
 */
type Svc = ReturnType<typeof createServiceClient>;
const BUCKET = "documents";
const MAX = 5000;

const rows = (data: unknown): ExportRow[] => (Array.isArray(data) ? (data as ExportRow[]) : []);
const ids = (list: ExportRow[]) => list.map((r) => String(r.id)).filter(Boolean);

export async function collectExportSections(svc: Svc, userId: string): Promise<Partial<Record<ExportSection, ExportRow[] | ExportRow | null>>> {
  const [profile, privacy, consents, requests, applications, policies, payments, claims, complaints, documents, households, beneficiaries, sponsorships, ai, notifications, kyc, cards, voice, needs, contacts, explainer] =
    await Promise.all([
      svc.from("profiles").select("*").eq("id", userId).maybeSingle(),
      svc.from("privacy_requests")
        .select("id, reference, type, status, channel, note, due_at, created_at, identity_verified_at, decision, decision_reason, decided_at, fulfilled_at, fulfilment_note, retention_note, closed_at, withdrawn_at, export_generated_at, export_downloaded_at")
        .eq("user_id", userId).order("created_at").limit(MAX),
      svc.from("consents").select("*").eq("user_id", userId).order("created_at").limit(MAX),
      svc.from("requests").select("*").eq("customer_id", userId).order("created_at").limit(MAX),
      svc.from("applications").select("*").eq("customer_id", userId).limit(MAX),
      svc.from("policies").select("*").eq("customer_id", userId).limit(MAX),
      svc.from("payments").select("*").eq("customer_id", userId).order("created_at").limit(MAX),
      svc.from("claims").select("*").eq("customer_id", userId).limit(MAX),
      svc.from("complaints").select("*").eq("customer_id", userId).limit(MAX),
      svc.from("documents").select("*").eq("owner_id", userId).limit(MAX),
      svc.from("households").select("*").eq("owner_user_id", userId).limit(MAX),
      svc.from("beneficiaries").select("*").eq("sponsor_user_id", userId).limit(MAX),
      svc.from("sponsorships").select("*").eq("sponsor_user_id", userId).limit(MAX),
      svc.from("ai_threads").select("id, surface, title, messages, request_id, created_at, updated_at").eq("user_id", userId).limit(MAX),
      svc.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
      svc.from("kyc_verifications").select("*").eq("user_id", userId).limit(MAX),
      svc.from("payment_methods").select("*").eq("user_id", userId).limit(MAX),
      svc.from("voice_notes").select("*").eq("owner_id", userId).limit(MAX),
      svc.from("needs_assessments").select("id, answers, suggested_categories, created_at").eq("user_id", userId).limit(MAX),
      svc.from("wa_contacts").select("id").eq("user_id", userId).limit(50),
      svc.from("policy_explainer_logs").select("*").eq("user_id", userId).order("created_at").limit(MAX),
    ]);
  // Phase 4: driving-score enrolments + monthly scores (one section, `kind` tells them apart) and trip summaries.
  const [enrolments, telematicsScores, telematicsTrips] = await Promise.all([
    svc.from("telematics_enrolments").select("id, policy_id, status, device_label, consent_version, enrolled_at, withdrawn_at, created_at").eq("user_id", userId).limit(MAX),
    svc.from("telematics_scores").select("id, policy_id, enrolment_id, period, score, factors, trips, distance_km, final, computed_at, created_at").eq("user_id", userId).order("period").limit(MAX),
    svc.from("telematics_trips").select("id, trip_id, policy_id, started_at, ended_at, distance_km, max_speed_band, harsh_brake_count, harsh_accel_count, night_share, phone_use, created_at").eq("user_id", userId).order("started_at").limit(MAX),
  ]);
  for (const r of [profile, privacy, consents, requests, applications, policies, payments, claims, complaints, documents]) {
    if (r.error) throw r.error;
  }

  const requestIds = ids(rows(requests.data));
  const claimIds = ids(rows(claims.data));
  const contactIds = ids(rows(contacts.data));
  const [quotes, messages, claimEvents, claimMessages, conversations, loyaltyDiscounts] = await Promise.all([
    requestIds.length ? svc.from("quotes").select("*").in("request_id", requestIds).limit(MAX) : Promise.resolve({ data: [], error: null }),
    requestIds.length ? svc.from("request_messages").select("*").in("request_id", requestIds).eq("internal", false).order("created_at").limit(MAX) : Promise.resolve({ data: [], error: null }),
    claimIds.length ? svc.from("claim_events").select("*").in("claim_id", claimIds).eq("visible_to_customer", true).order("created_at").limit(MAX) : Promise.resolve({ data: [], error: null }),
    claimIds.length ? svc.from("claim_messages").select("*").in("claim_id", claimIds).eq("internal", false).order("created_at").limit(MAX) : Promise.resolve({ data: [], error: null }),
    contactIds.length ? svc.from("wa_conversations").select("id").in("contact_id", contactIds).limit(500) : Promise.resolve({ data: [], error: null }),
    requestIds.length ? svc.from("quote_discounts").select("id, quote_id, request_id, rule_type, label, explanation, pct, amount, currency, capped, cap_note, created_at").in("request_id", requestIds).limit(MAX) : Promise.resolve({ data: [], error: null }),
  ]);
  const conversationIds = ids(rows(conversations.data));
  const wa = conversationIds.length
    ? await svc.from("wa_messages").select("id, conversation_id, direction, kind, body, template_name, sender_party, status, created_at").in("conversation_id", conversationIds).order("created_at").limit(MAX)
    : { data: [] };

  return {
    profile: (profile.data as unknown as ExportRow | null) ?? null,
    privacy_requests: rows(privacy.data),
    consents: rows(consents.data),
    requests: rows(requests.data),
    quotes: rows(quotes.data),
    applications: rows(applications.data),
    policies: rows(policies.data),
    payments: rows(payments.data),
    claims: rows(claims.data),
    claim_events: rows(claimEvents.data),
    complaints: rows(complaints.data),
    documents: rows(documents.data),
    households: rows(households.data),
    beneficiaries: rows(beneficiaries.data),
    sponsorships: rows(sponsorships.data),
    messages: rows(messages.data),
    claim_messages: rows(claimMessages.data),
    whatsapp_messages: rows(wa.data),
    ai_threads: rows(ai.data),
    notifications: rows(notifications.data),
    kyc_verifications: rows(kyc.data),
    payment_methods: rows(cards.data),
    voice_notes: rows(voice.data),
    needs_assessments: rows(needs.data),
    policy_explainer: rows(explainer.data),
    loyalty_discounts: rows(loyaltyDiscounts.data),
    telematics: [...rows(enrolments.data).map((r) => ({ kind: "enrolment", enrolment_id: r.id, ...r })), ...rows(telematicsScores.data).map((r) => ({ kind: "monthly_score", ...r }))],
    telematics_trips: rows(telematicsTrips.data),
  };
}

export interface GeneratedExport {
  path: string;
  bytes: number;
  sha256: string;
  counts: Record<string, number>;
}

/** Builds the JSON and uploads it (never overwrites: each generation gets a new timestamped path). */
export async function generateExportFile(svc: Svc, req: { id: string; reference: string; user_id: string }): Promise<GeneratedExport> {
  const sections = await collectExportSections(svc, req.user_id);
  const doc = buildPrivacyExport({ subjectId: req.user_id, reference: req.reference, requestId: req.id, generatedAt: new Date(), sections });
  const json = JSON.stringify(doc, null, 2);
  const body = new TextEncoder().encode(json);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const path = privacyExportPath(req.user_id, req.reference);
  const { error } = await svc.storage.from(BUCKET).upload(path, body, { contentType: "application/json", upsert: false });
  if (error) throw error;
  return { path, bytes: body.byteLength, sha256, counts: doc.counts };
}

/** Best-effort removal of Storage objects (old exports, avatar, voice notes). Returns what could not be removed. */
export async function removeStorageObjects(svc: Svc, paths: string[]): Promise<{ removed: number; failed: number }> {
  const list = [...new Set(paths.filter((p) => typeof p === "string" && p && !/^https?:\/\//i.test(p)))];
  if (!list.length) return { removed: 0, failed: 0 };
  const { data, error } = await svc.storage.from(BUCKET).remove(list);
  if (error) return { removed: 0, failed: list.length };
  return { removed: data?.length ?? list.length, failed: 0 };
}
