import "server-only";
import { notFound } from "next/navigation";
import type { RiskField } from "@im/core";
import type { Row } from "@im/db";
import { requireKind, type PartnerContext } from "../../_lib/context";
import { getCategoryMap } from "../../_lib/data";

export const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export interface VersionPage {
  ctx: PartnerContext;
  product: Row<"products">;
  version: Row<"product_versions">;
  versions: Pick<Row<"product_versions">, "id" | "version" | "status" | "compliance_status">[];
  riskFields: RiskField[];
  categoryName: string;
}

/** Loads a product version the active insurer owns, for the version workspace pages. */
export async function loadVersionPage(productId: string, versionId: string): Promise<VersionPage> {
  const ctx = await requireKind("insurer");
  if (!isUuid(productId) || !isUuid(versionId)) notFound();
  const { data: product } = await ctx.supabase.from("products").select("*").eq("id", productId).maybeSingle();
  if (!product || product.insurer_org_id !== ctx.orgId) notFound();
  const [{ data: version }, { data: versions }, cats] = await Promise.all([
    ctx.supabase.from("product_versions").select("*").eq("id", versionId).eq("product_id", productId).maybeSingle(),
    ctx.supabase.from("product_versions").select("id, version, status, compliance_status").eq("product_id", productId).order("version", { ascending: false }),
    getCategoryMap(),
  ]);
  if (!version) notFound();
  const category = cats.get(product.category_id);
  return { ctx, product, version, versions: versions ?? [], riskFields: ((category?.risk_schema ?? []) as unknown as RiskField[]) ?? [], categoryName: category?.name ?? "" };
}

export const versionHref = (productId: string, versionId: string, sub = "") => `/partner/products/${productId}/versions/${versionId}${sub ? `/${sub}` : ""}`;

export const COMPLIANCE_TONE: Record<string, "ok" | "wait" | "danger" | "neutral" | "info"> = {
  draft: "neutral",
  submitted: "wait",
  in_review: "info",
  returned: "danger",
  published: "ok",
};

/** Request-time clock for the version pages (only called after `loadVersionPage`, which awaits the session). */
export function requestTime(): number {
  return Date.now();
}
