import "server-only";
import { notFound } from "next/navigation";
import type { Row } from "@im/db";
import { STORAGE_BUCKETS } from "@im/db";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Customer-area read helpers. Everything goes through the RLS client (`createClient`), which
 * reads cookies — callers must render inside <Suspense> and never inside "use cache".
 */

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function account(next = "/account") {
  const user = await requireUser(next);
  const supabase = await createClient();
  return { user, supabase };
}

/** Columns customers may read on a broker/insurer (public directory, RLS). */
export const ORG_COLS = "id, name, slug, type, brand_color, logo_url, settings, nic_licence_number, contact_email, contact_phone, website";
export type OrgLite = Pick<
  Row<"organizations">,
  "id" | "name" | "slug" | "type" | "brand_color" | "logo_url" | "settings" | "nic_licence_number" | "contact_email" | "contact_phone" | "website"
>;
export const CATEGORY_COLS = "id, slug, name, icon, availability, segment, risk_schema, required_documents";
export type CategoryLite = Pick<Row<"product_categories">, "id" | "slug" | "name" | "icon" | "availability" | "segment" | "risk_schema" | "required_documents">;

export type RequestWithRefs = Row<"requests"> & {
  category: CategoryLite | null;
  broker: OrgLite | null;
};

export const REQUEST_SELECT = `*, category:product_categories(${CATEGORY_COLS}), broker:organizations!requests_broker_org_id_fkey(${ORG_COLS})`;

export async function getRequestOr404(supabase: Supabase, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await supabase.from("requests").select(REQUEST_SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  return data as unknown as RequestWithRefs;
}

export type PolicyWithRefs = Row<"policies"> & {
  category: CategoryLite | null;
  insurer: OrgLite | null;
  broker: OrgLite | null;
};
export const POLICY_SELECT = `*, category:product_categories(${CATEGORY_COLS}), insurer:organizations!policies_insurer_org_id_fkey(${ORG_COLS}), broker:organizations!policies_broker_org_id_fkey(${ORG_COLS})`;

export async function getPolicyOr404(supabase: Supabase, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await supabase.from("policies").select(POLICY_SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  return data as unknown as PolicyWithRefs;
}

/** Signed download URLs for private documents (1 hour). Storage RLS decides what is signable. */
export async function signUrls(supabase: Supabase, paths: string[], download = false): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabase.storage.from(STORAGE_BUCKETS.documents).createSignedUrls(unique, 3600, download ? { download: true } : undefined);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

export function policyTitle(p: Pick<Row<"policies">, "nickname" | "summary"> & { category?: { name: string } | null }) {
  return p.nickname || p.summary || p.category?.name || "Policy";
}

/** "Motor · Comprehensive" style eyebrow from category + insured items/risk. */
export function coverLabel(categoryName: string | undefined, risk: Record<string, unknown> | null | undefined) {
  const r = risk ?? {};
  const variant = (r.cover_type ?? r.plan_level ?? r.plan_type ?? r.cover_scope ?? r.liability_type ?? r.transit_type) as string | undefined;
  const pretty = variant ? String(variant).replace(/_/g, " ") : null;
  return [categoryName, pretty ? pretty.replace(/^\w/, (c) => c.toUpperCase()) : null].filter(Boolean).join(" · ");
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
