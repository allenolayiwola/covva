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

/**
 * The terms in force today (the same row checkout uses: effective_from <= today <= effective_to) and the
 * next scheduled change, if one is dated later.
 */
export async function termsFor(supabase: Supabase, orgId: string, on = new Date().toISOString().slice(0, 10)) {
  const [current, scheduled] = await Promise.all([
    supabase
      .from("org_commercial_terms")
      .select("*")
      .eq("org_id", orgId)
      .lte("effective_from", on)
      .or(`effective_to.is.null,effective_to.gte.${on}`)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("org_commercial_terms").select("*").eq("org_id", orgId).gt("effective_from", on).order("effective_from").limit(1).maybeSingle(),
  ]);
  return { current: current.data ?? null, scheduled: scheduled.data ?? null };
}
