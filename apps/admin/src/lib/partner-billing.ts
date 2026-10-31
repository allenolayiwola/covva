import "server-only";
import type { createClient } from "@/lib/supabase/server";

/** Missing flags and failed reads both disable billing. Check again in every action. */
export async function partnerBillingEnabled(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data, error } = await supabase.from("feature_flags").select("enabled").eq("key", "partner_platform_fee").maybeSingle();
  return !error && data?.enabled === true;
}
