import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { SERVICE_PARTNER_KIND_LABELS, type ServicePartnerKind } from "@im/core";
import type { Row } from "@im/db";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * Public, cacheable post-claim partner directory (approved partners only — RLS "service partners: public directory").
 * Used by the marketing page /claims/network and the customer claim page's "near you" card.
 * Admin changes call revalidateTag("service-partners").
 */
export type PublicServicePartner = Pick<Row<"service_partners">, "id" | "kind" | "name" | "phone" | "address" | "region" | "services" | "direct_billing_insurer_ids" | "rating">;

export async function getApprovedServicePartners(): Promise<PublicServicePartner[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("service-partners");
  const { data } = await createPublicClient()
    .from("service_partners")
    .select("id, kind, name, phone, address, region, services, direct_billing_insurer_ids, rating")
    .eq("status", "approved")
    .order("region")
    .order("name");
  return data ?? [];
}

export function groupPartners(partners: PublicServicePartner[]): { region: string; kinds: { kind: ServicePartnerKind; label: string; partners: PublicServicePartner[] }[] }[] {
  const byRegion = new Map<string, Map<string, PublicServicePartner[]>>();
  for (const p of partners) {
    const region = p.region?.trim() || "Nationwide";
    const kinds = byRegion.get(region) ?? new Map<string, PublicServicePartner[]>();
    kinds.set(p.kind, [...(kinds.get(p.kind) ?? []), p]);
    byRegion.set(region, kinds);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, kinds]) => ({
      region,
      kinds: [...kinds.entries()].map(([kind, list]) => ({ kind: kind as ServicePartnerKind, label: SERVICE_PARTNER_KIND_LABELS[kind as ServicePartnerKind] ?? kind, partners: list })),
    }));
}
