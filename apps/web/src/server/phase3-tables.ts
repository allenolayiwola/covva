import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Hand-declared row types for the tables added by
 * supabase/migrations/20261030100100_i18n_ussd_voice.sql (translations, ussd_sessions,
 * voice_notes). Code in this stream compiles against these instead of the generated
 * `@im/db` types so it doesn't depend on when database.types.ts is regenerated.
 * Keep in sync with the migration.
 */
export interface TranslationRowDb {
  id: string;
  locale: string;
  key: string;
  value: string;
  status: "draft" | "reviewed" | "approved";
  note: string | null;
  translator_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UssdSessionRow {
  id: string;
  session_id: string;
  provider: "africastalking" | "hubtel" | "arkesel" | "simulator";
  msisdn: string;
  network: string | null;
  service_code: string | null;
  customer_id: string | null;
  lead_id: string | null;
  locale: string;
  step: string;
  state: Record<string, unknown>;
  last_input: string | null;
  hops: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

export type VoicePurpose = "quote_help" | "claim_description" | "support";
export type TranscriptStatus = "pending" | "done" | "failed";

export interface VoiceNoteRow {
  id: string;
  owner_id: string;
  purpose: VoicePurpose;
  request_id: string | null;
  claim_id: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  language_hint: string | null;
  transcript: string | null;
  transcript_language: string | null;
  transcript_status: TranscriptStatus;
  transcript_edited_at: string | null;
  failure_reason: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export type Phase3Table = "translations" | "ussd_sessions" | "voice_notes";

/**
 * Query one of the tables above through any Supabase client (user, service or public) without
 * the generated schema. Results are untyped: cast to the row interfaces in this file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromTable(client: SupabaseClient<any, any, any>, table: Phase3Table) {
  return (client as unknown as SupabaseClient).from(table);
}
