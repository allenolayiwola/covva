import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@im/db";

/**
 * Hand-declared types for the SME & group tables, column and RPCs added by
 * supabase/migrations/20261030100300_sme_group.sql (pending review). server/business.ts and the business pages
 * compile against these so they don't depend on when packages/db/src/database.types.ts is regenerated. Keep in
 * sync with the migration; once the shared types include it, `smeDb()` can be replaced by the plain client.
 */
export type SchemeStatusDb = "draft" | "quoting" | "active" | "lapsed" | "cancelled";

export interface GroupSchemeRow {
  id: string;
  reference: string;
  business_org_id: string;
  category_id: string;
  name: string;
  status: SchemeStatusDb;
  broker_org_id: string | null;
  insurer_org_id: string | null;
  policy_id: string | null;
  request_id: string | null;
  member_count: number;
  renewal_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchemeMemberRow {
  id: string;
  scheme_id: string;
  employee_ref: string | null;
  full_name: string;
  date_of_birth: string | null;
  gender: "female" | "male" | "other" | null;
  phone: string | null;
  email: string | null;
  ghana_card_last4: string | null;
  relationship: "employee" | "spouse" | "child" | "parent";
  principal_member_id: string | null;
  cover_tier: string | null;
  salary_band: string | null;
  status: "active" | "pending" | "removed";
  user_id: string | null;
  joined_at: string;
  left_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetVehicleRow {
  id: string;
  business_org_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  value: number | null;
  use: "private" | "commercial" | "hire";
  driver_name: string | null;
  status: "active" | "removed";
  policy_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessAssetRow {
  id: string;
  business_org_id: string;
  kind: "property" | "stock" | "equipment" | "liability_exposure";
  description: string;
  address: string | null;
  value: number | null;
  status: "active" | "removed";
  policy_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface BusinessInvoiceRow {
  id: string;
  reference: string;
  business_org_id: string;
  period_start: string;
  period_end: string;
  currency: string;
  total: number;
  lines: Json;
  status: "draft" | "issued" | "paid" | "overdue";
  due_at: string | null;
  issued_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type Table<R, I> = { Row: R; Insert: I; Update: Partial<R>; Relationships: [] };
type Tables = Database["public"]["Tables"];
type Functions = Database["public"]["Functions"];
type OrgRow = Tables["organizations"]["Row"] & { business_profile: Json };

type SmeTables = Omit<Tables, "group_schemes" | "scheme_members" | "fleet_vehicles" | "business_assets" | "business_invoices" | "organizations"> & {
  group_schemes: Table<GroupSchemeRow, Optional<GroupSchemeRow, "id" | "reference" | "status" | "broker_org_id" | "insurer_org_id" | "policy_id" | "request_id" | "member_count" | "renewal_date" | "notes" | "created_by" | "created_at" | "updated_at">>;
  scheme_members: Table<SchemeMemberRow, Optional<SchemeMemberRow, "id" | "employee_ref" | "date_of_birth" | "gender" | "phone" | "email" | "ghana_card_last4" | "relationship" | "principal_member_id" | "cover_tier" | "salary_band" | "status" | "user_id" | "joined_at" | "left_at" | "created_at" | "updated_at">>;
  fleet_vehicles: Table<FleetVehicleRow, Optional<FleetVehicleRow, "id" | "make" | "model" | "year" | "value" | "use" | "driver_name" | "status" | "policy_id" | "created_by" | "created_at" | "updated_at">>;
  business_assets: Table<BusinessAssetRow, Optional<BusinessAssetRow, "id" | "address" | "value" | "status" | "policy_id" | "created_by" | "created_at" | "updated_at">>;
  business_invoices: Table<BusinessInvoiceRow, Optional<BusinessInvoiceRow, "id" | "reference" | "currency" | "total" | "lines" | "status" | "due_at" | "issued_at" | "paid_at" | "created_at" | "updated_at">>;
  organizations: {
    Row: OrgRow;
    Insert: Tables["organizations"]["Insert"] & { business_profile?: Json };
    Update: Tables["organizations"]["Update"] & { business_profile?: Json };
    Relationships: Tables["organizations"]["Relationships"];
  };
};

type SmeFunctions = Omit<Functions, "create_business_account" | "link_my_scheme_memberships"> & {
  create_business_account: { Args: { p_name: string; p_profile?: Json }; Returns: string };
  link_my_scheme_memberships: { Args: Record<PropertyKey, never>; Returns: number };
};

export type SmeDatabase = Omit<Database, "public"> & { public: Omit<Database["public"], "Tables" | "Functions"> & { Tables: SmeTables; Functions: SmeFunctions } };
export type SmeDb = SupabaseClient<SmeDatabase>;

/** The same client, typed with the SME & group tables (see the note above). */
export function smeDb(client: SupabaseClient<Database>): SmeDb {
  return client as unknown as SmeDb;
}
