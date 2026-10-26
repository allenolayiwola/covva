"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GHANA_REGIONS } from "@im/core";
import type { Insert } from "@im/db";
import { getSetting } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { normaliseGhanaCard, normaliseGhanaPhone, safeNext, type ActionState } from "@/components/customer/utils";

const Onboarding = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(120),
  phone: z.string().trim().min(1, "Enter your mobile number"),
  region: z.enum(GHANA_REGIONS as unknown as [string, ...string[]], { error: "Choose your region" }),
  ghana_card: z.string().trim().max(20).optional(),
  terms: z.literal("on", { error: "Please accept the terms of use" }),
  privacy: z.literal("on", { error: "Please confirm you've read the privacy notice" }),
  data_sharing_broker: z.literal("on", { error: "We need this to connect you with a broker" }),
  data_sharing_insurer: z.literal("on", { error: "We need this so insurers can quote and issue cover" }),
  marketing: z.literal("on").optional(),
  ai_assistance: z.literal("on").optional(),
  next: z.string().optional(),
});

function clientIp(h: Headers): string | null {
  const raw = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0]?.trim() ?? "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw) || /^[0-9a-f:]+$/i.test(raw)) return raw || null;
  return null;
}

export async function completeOnboarding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return { ok: false, error: "Your session has ended. Please sign in again." };

  const parsed = Onboarding.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please check the highlighted items.", fieldErrors };
  }
  const v = parsed.data;
  const phone = normaliseGhanaPhone(v.phone);
  if (!phone) return { ok: false, error: "Please check the highlighted items.", fieldErrors: { phone: "Enter a Ghana number, e.g. 024 123 4567" } };
  const card = v.ghana_card ? normaliseGhanaCard(v.ghana_card) : null;
  if (v.ghana_card && !card) {
    return { ok: false, error: "Please check the highlighted items.", fieldErrors: { ghana_card: "Use the format GHA-123456789-0" } };
  }

  const [termsVersion, privacyVersion] = await Promise.all([getSetting<string>("terms_version"), getSetting<string>("privacy_version")]);
  const h = await headers();
  const base = {
    user_id: user.id,
    context: "onboarding",
    ip_address: clientIp(h),
    user_agent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
  const tv = termsVersion ?? "unversioned";
  const pv = privacyVersion ?? "unversioned";
  const consents: Insert<"consents">[] = [
    { ...base, type: "terms", version: tv, granted: true },
    { ...base, type: "privacy", version: pv, granted: true },
    { ...base, type: "data_sharing_broker", version: pv, granted: true },
    { ...base, type: "data_sharing_insurer", version: pv, granted: true },
    { ...base, type: "marketing", version: pv, granted: v.marketing === "on" },
    { ...base, type: "ai_assistance", version: pv, granted: v.ai_assistance === "on" },
  ];
  const { error: consentErr } = await supabase.from("consents").insert(consents);
  if (consentErr) return { ok: false, error: "We couldn't record your choices. Please try again." };

  if (card) {
    // KYC review is done by platform staff; the customer can only submit a pending check (RLS).
    await supabase.from("kyc_verifications").insert({ user_id: user.id, method: "ghana_card", id_number: card, status: "pending" });
  }

  const { error: profileErr } = await supabase
    .from("profiles")
    .update({
      full_name: v.full_name,
      phone,
      region: v.region,
      ...(card ? { ghana_card_number: card, kyc_status: "pending" as const } : {}),
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (profileErr) return { ok: false, error: "We couldn't save your details. Please try again." };

  redirect(safeNext(v.next));
}
