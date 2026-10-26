import type { Database } from "./database.types";

export type { Database, Json } from "./database.types";

type PublicSchema = Database["public"];

/** Row type for a public table, e.g. `Row<"requests">`. */
export type Row<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
/** Insert type for a public table. */
export type Insert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
/** Update type for a public table. */
export type Update<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
/** Enum type, e.g. `Enum<"request_status">`. */
export type Enum<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export const SUPABASE_PROJECT_REF = "krmnyqaweawkpygjmdry";
export const STORAGE_BUCKETS = { documents: "documents", orgAssets: "org-assets" } as const;

/** Path convention for the private documents bucket: `{customerId}/{scope}/{uuid}-{fileName}`. */
export function documentPath(customerId: string, scope: "requests" | "policies" | "claims" | "profile", fileName: string) {
  const safe = fileName.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").slice(-80);
  const id = globalThis.crypto.randomUUID();
  return `${customerId}/${scope}/${id}-${safe}`;
}
