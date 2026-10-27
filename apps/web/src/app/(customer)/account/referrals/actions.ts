"use server";
import { refresh } from "next/cache";
import { referralCode } from "@im/core";
import { createClient } from "@/lib/supabase/server";

export type LinkState = { ok: boolean; error?: string } | null;

/** Create (or return) the signed-in customer's personal referral link. */
export async function createMyLink(): Promise<LinkState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Your session has ended. Please sign in again." };
  const { error } = await supabase.rpc("ensure_my_referral_link", { p_code: referralCode() });
  if (error) return { ok: false, error: "We couldn't create your link. Please try again." };
  refresh();
  return { ok: true };
}
