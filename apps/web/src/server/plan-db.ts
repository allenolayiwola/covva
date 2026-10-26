import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@im/db";

/**
 * Hand-declared types for the instalment / micro tables and columns added by
 * supabase/migrations/20261030100000_instalments_micro.sql (pending review). The code in
 * server/instalments.ts and server/micro.ts is written against these so it compiles whether or not
 * packages/db/src/database.types.ts has been regenerated with that migration. When the migration
 * is approved and the shared types include it, `planDb()` can be replaced by the plain client.
 */
export interface InstalmentScheduleRow {
  id: string;
  policy_id: string | null;
  application_id: string | null;
  customer_id: string;
  payer_user_id: string;
  insurer_org_id: string;
  plan_key: string;
  plan: Json;
  currency: string;
  total_amount: number;
  instalment_count: number;
  status: string;
  grace_until: string | null;
  lapsed_at: string | null;
  reinstated_at: string | null;
  reinstatement_requested_at: string | null;
  reinstatement_review: string | null;
  payment_method_id: string | null;
  channel: string;
  momo_network: string | null;
  momo_phone: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface InstalmentRow {
  id: string;
  schedule_id: string;
  seq: number;
  due_at: string;
  amount: number;
  status: string;
  payment_id: string | null;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MicroSessionRow {
  id: string;
  policy_id: string;
  customer_id: string;
  period: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  payment_id: string | null;
  channel: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PolicyPlanColumns {
  period: string;
  micro: boolean;
  auto_renew: boolean;
  instalment_schedule_id: string | null;
}

export interface VersionPlanColumns {
  periods: string[];
  instalment_plans: Json;
  micro: boolean;
  audience_tags: string[];
}

type Optional<R, K extends keyof R> = Omit<R, K> & Partial<Pick<R, K>>;
type Table<R, I> = { Row: R; Insert: I; Update: Partial<R>; Relationships: [] };
type Tables = Database["public"]["Tables"];
type Extend<T extends keyof Tables, X> = {
  Row: Tables[T]["Row"] & X;
  Insert: Tables[T]["Insert"] & Partial<X>;
  Update: Tables[T]["Update"] & Partial<X>;
  Relationships: Tables[T]["Relationships"];
};

type PlanTables = Omit<Tables, "instalment_schedules" | "instalments" | "micro_sessions" | "policies" | "product_versions"> & {
  instalment_schedules: Table<InstalmentScheduleRow, Optional<InstalmentScheduleRow, "id" | "policy_id" | "application_id" | "plan" | "currency" | "status" | "grace_until" | "lapsed_at" | "reinstated_at" | "reinstatement_requested_at" | "reinstatement_review" | "payment_method_id" | "channel" | "momo_network" | "momo_phone" | "metadata" | "created_at" | "updated_at">>;
  instalments: Table<InstalmentRow, Optional<InstalmentRow, "id" | "status" | "payment_id" | "attempts" | "last_attempt_at" | "next_attempt_at" | "paid_at" | "created_at" | "updated_at">>;
  micro_sessions: Table<MicroSessionRow, Optional<MicroSessionRow, "id" | "period" | "payment_id" | "channel" | "status" | "created_at" | "updated_at">>;
  policies: Extend<"policies", PolicyPlanColumns>;
  product_versions: Extend<"product_versions", VersionPlanColumns>;
};

export type PlanDatabase = Omit<Database, "public"> & { public: Omit<Database["public"], "Tables"> & { Tables: PlanTables } };
export type PlanDb = SupabaseClient<PlanDatabase>;

/** The same client, typed with the instalment / micro tables (see the note above). */
export function planDb(client: SupabaseClient<Database>): PlanDb {
  return client as unknown as PlanDb;
}
