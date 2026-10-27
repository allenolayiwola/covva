import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Hand-declared row types for translations / ussd_sessions (migration
 * 20261030100100_i18n_ussd_voice.sql), so these pages don't depend on when database.types.ts
 * is regenerated. Keep in sync with the migration.
 */
export interface TranslationRow {
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
  provider: string;
  msisdn: string;
  network: string | null;
  service_code: string | null;
  customer_id: string | null;
  lead_id: string | null;
  locale: string;
  step: string;
  state: { history?: string[]; policies?: unknown[]; instalments?: unknown[] } | null;
  last_input: string | null;
  hops: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromTable(client: SupabaseClient<any, any, any>, table: "translations" | "ussd_sessions") {
  return (client as unknown as SupabaseClient).from(table);
}
