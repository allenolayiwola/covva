import "server-only";
import type { Supabase } from "@/lib/query";

/** Defaults new partners start on (platform_settings). Partner registration in the web app reads the same keys. */
export interface CommercialDefaults {
  platformFeePct: number;
  revenueSharePct: number;
}

export const DEFAULT_KEYS = {
  platformFeePct: "commercial.default_platform_fee_pct",
  revenueSharePct: "commercial.default_revenue_share_pct",
} as const;

function pct(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

export async function commercialDefaults(supabase: Supabase): Promise<CommercialDefaults> {
  const { data } = await supabase.from("platform_settings").select("key, value").in("key", Object.values(DEFAULT_KEYS));
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  return {
    // Same fallbacks as approve_partner_application.
    platformFeePct: pct(byKey.get(DEFAULT_KEYS.platformFeePct), 0),
    revenueSharePct: pct(byKey.get(DEFAULT_KEYS.revenueSharePct), 20),
  };
}

/** The organisation's open commercial terms row, if any. */
export async function openTerms(supabase: Supabase, orgId: string) {
  const { data } = await supabase
    .from("org_commercial_terms")
    .select("*")
    .eq("org_id", orgId)
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
