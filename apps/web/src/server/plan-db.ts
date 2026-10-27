import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Row } from "@im/db";

/**
 * Row aliases for the instalment / micro tables and columns added by
 * supabase/migrations/20261030100000_instalments_micro.sql (types generated into
 * packages/db/src/database.types.ts). `planDb()` is kept as the single place the instalment and
 * micro modules get their client from, so a schema change only needs touching here.
 */
export type InstalmentScheduleRow = Row<"instalment_schedules">;
export type InstalmentRow = Row<"instalments">;
export type MicroSessionRow = Row<"micro_sessions">;
export type PolicyPlanColumns = Pick<Row<"policies">, "period" | "micro" | "auto_renew" | "instalment_schedule_id">;
export type VersionPlanColumns = Pick<Row<"product_versions">, "periods" | "instalment_plans" | "micro" | "audience_tags">;

export type PlanDb = SupabaseClient<Database>;

export function planDb(client: SupabaseClient<Database>): PlanDb {
  return client;
}
