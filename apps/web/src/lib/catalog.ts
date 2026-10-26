import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { Row } from "@im/db";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * Public, cacheable catalogue reads. These use the anonymous client (no cookies)
 * so they can sit inside "use cache". Admin changes call revalidateTag("catalog", "max").
 */
export type Category = Row<"product_categories">;

export async function getCategories(): Promise<Category[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog", "categories");
  const { data } = await createPublicClient().from("product_categories").select("*").order("sort_order");
  return data ?? [];
}

export async function getCategory(slug: string): Promise<Category | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog", `category:${slug}`);
  const { data } = await createPublicClient().from("product_categories").select("*").eq("slug", slug).maybeSingle();
  return data;
}

export type PublicProduct = Pick<Row<"products">, "id" | "name" | "tier" | "summary" | "category_id"> & {
  insurer: Pick<Row<"organizations">, "id" | "name" | "slug" | "brand_color" | "logo_url" | "settings"> | null;
  version: Pick<Row<"product_versions">, "coverage" | "limits" | "excesses" | "exclusions" | "key_exclusion" | "waiting_period_days" | "optional_benefits"> | null;
};

export async function getProductsForCategory(categoryId: string): Promise<PublicProduct[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog", `products:${categoryId}`);
  const { data } = await createPublicClient()
    .from("products")
    .select("id, name, tier, summary, category_id, insurer:organizations!products_insurer_org_id_fkey(id, name, slug, brand_color, logo_url, settings), version:product_versions!products_current_version_fk(coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits)")
    .eq("category_id", categoryId)
    .eq("status", "approved");
  return (data ?? []) as unknown as PublicProduct[];
}

export type PublicOrg = Pick<Row<"organizations">, "id" | "name" | "slug" | "type" | "description" | "nic_licence_number" | "nic_licence_class" | "region" | "brand_color" | "logo_url" | "website" | "settings">;

export async function getPartnerDirectory(): Promise<{ brokers: PublicOrg[]; insurers: PublicOrg[] }> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog", "partners");
  const { data } = await createPublicClient()
    .from("organizations")
    .select("id, name, slug, type, description, nic_licence_number, nic_licence_class, region, brand_color, logo_url, website, settings")
    .eq("status", "active")
    .in("type", ["broker", "insurer"])
    .order("name");
  const orgs = (data ?? []) as PublicOrg[];
  return { brokers: orgs.filter((o) => o.type === "broker"), insurers: orgs.filter((o) => o.type === "insurer") };
}

export async function getFlags(): Promise<Record<string, boolean>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("flags");
  const { data } = await createPublicClient().from("feature_flags").select("key, enabled");
  return Object.fromEntries((data ?? []).map((f) => [f.key, f.enabled]));
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("settings");
  const { data } = await createPublicClient().from("platform_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function getPlans() {
  "use cache";
  cacheLife("hours");
  cacheTag("plans");
  const { data } = await createPublicClient().from("plans").select("*").eq("active", true).order("sort_order");
  return data ?? [];
}
