import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Row } from "@im/db";

/**
 * Row types for the SME & group tables (supabase/migrations/20261030100300_sme_group.sql), taken from the generated
 * `@im/db` types. `smeDb()` is kept as the single place to adapt the client if the shared types are ever regenerated
 * without these tables (re-run `generate_typescript_types` against the project rather than hand-editing them).
 */
export type GroupSchemeRow = Row<"group_schemes">;
export type SchemeMemberRow = Row<"scheme_members">;
export type FleetVehicleRow = Row<"fleet_vehicles">;
export type BusinessAssetRow = Row<"business_assets">;
export type BusinessInvoiceRow = Row<"business_invoices">;
export type AssetKind = "property" | "stock" | "equipment" | "liability_exposure";

/** One line of a consolidated statement (`business_invoices.lines[]`). */
export interface InvoiceLineDb {
  policy_id: string | null;
  scheme_id: string | null;
  application_id: string | null;
  instalment_id?: string | null;
  description: string;
  amount: number;
  insurer_org_id: string;
  insurer_name: string | null;
  basis?: string;
  payment_id?: string | null;
  payment_status?: string | null;
}

export type SmeDb = SupabaseClient<Database>;

export function smeDb(client: SupabaseClient<Database>): SmeDb {
  return client;
}
