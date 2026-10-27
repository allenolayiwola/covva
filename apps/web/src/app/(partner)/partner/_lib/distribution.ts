import "server-only";
import { redirect } from "next/navigation";
import { getPartnerContext, type PartnerContext } from "./context";

/** Distributor-only page guard + the partner profile and links (RLS: members read their own). */
export async function getDistributorContext(): Promise<{ ctx: PartnerContext; partner: DistributorProfile | null; links: DistributorLink[] }> {
  const ctx = await getPartnerContext();
  if (ctx.kind !== "distributor") redirect("/partner");
  const [{ data: partner }, { data: links }] = await Promise.all([
    ctx.supabase.from("distribution_partners").select("org_id, segment, allowed_categories, widget_domains, brand, revenue_share_pct, status, contract_ref").eq("org_id", ctx.orgId).maybeSingle(),
    ctx.supabase.from("referral_links").select("id, code, campaign, landing_path, created_at, disabled_at").eq("owner_org_id", ctx.orgId).order("created_at", { ascending: true }),
  ]);
  return { ctx, partner: (partner as DistributorProfile | null) ?? null, links: links ?? [] };
}

export interface DistributorProfile {
  org_id: string;
  segment: string;
  allowed_categories: string[];
  widget_domains: string[];
  brand: { primary_colour?: string; logo_url?: string } | null;
  revenue_share_pct: number;
  status: string;
  contract_ref: string | null;
}

export interface DistributorLink { id: string; code: string; campaign: string | null; landing_path: string; created_at: string; disabled_at: string | null }

/** The widget code: the first enabled link (created by Covva staff with the partner profile, or on first API call). */
export function widgetCode(links: DistributorLink[]): string | null {
  return links.find((l) => !l.disabled_at)?.code ?? null;
}
