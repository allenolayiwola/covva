"use server";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { runIdentityCheck } from "@/server/lookups";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GHANA_REGIONS } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { normaliseGhanaCard, normaliseGhanaPhone, type ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../_lib/action";

const Profile = z
  .object({
    full_name: z.string().trim().min(2, "Enter your full name").max(120),
    preferred_name: z.string().trim().max(60).optional(),
    phone: z.string().trim().min(1, "Enter your mobile number"),
    region: z.enum(GHANA_REGIONS as unknown as [string, ...string[]], { error: "Choose your region" }),
    city: z.string().trim().max(80).optional(),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
    account_type: z.enum(["individual", "business"]),
    business_name: z.string().trim().max(160).optional(),
    ghana_card: z.string().trim().max(20).optional(),
  })
  .refine((v) => v.account_type === "individual" || (v.business_name?.length ?? 0) >= 2, { message: "Enter your business name", path: ["business_name"] });

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = Profile.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: fe };
  }
  const v = parsed.data;
  const phone = normaliseGhanaPhone(v.phone);
  if (!phone) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a Ghana number, e.g. 024 123 4567" } };

  const { data: current } = await supabase.from("profiles").select("ghana_card_number, kyc_status").eq("id", user.id).single();
  let card: string | null | undefined;
  if (v.ghana_card && current?.kyc_status !== "verified") {
    card = normaliseGhanaCard(v.ghana_card);
    if (!card) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { ghana_card: "Use the format GHA-123456789-0" } };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: v.full_name,
      preferred_name: v.preferred_name || null,
      phone,
      region: v.region,
      city: v.city || null,
      date_of_birth: v.date_of_birth ?? null,
      account_type: v.account_type,
      business_name: v.account_type === "business" ? v.business_name ?? null : null,
      ...(card && card !== current?.ghana_card_number ? { ghana_card_number: card, kyc_status: "pending" as const } : {}),
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: dbError(error, "We couldn't save your details.") };
  if (card && card !== current?.ghana_card_number) {
    const { data: kyc } = await supabase.from("kyc_verifications").insert({ user_id: user.id, method: "ghana_card", id_number: card, status: "pending", provider: "manual" }).select("id").single();
    // Identity provider hook (NIA when configured); manual admin review stays the fallback.
    if (kyc?.id) {
      try {
        await runIdentityCheck(createServiceClient(), kyc.id);
      } catch (err) {
        console.error("identity check failed; left for manual review", err);
      }
    }
  }
  revalidatePath("/account", "layout");
  return { ok: true, message: "Your details have been saved." };
}

export async function updateNotificationPrefs(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const prefs = {
    email: formData.get("email") === "on",
    sms: formData.get("sms") === "on",
    push: formData.get("push") === "on",
    whatsapp: formData.get("whatsapp") === "on",
  };
  // WhatsApp is an explicit opt-in (profiles.whatsapp_opt_in) as well as a preference; both move together.
  const { error } = await supabase.from("profiles").update({ notification_prefs: prefs, whatsapp_opt_in: prefs.whatsapp }).eq("id", user.id);
  if (error) return { ok: false, error: dbError(error, "We couldn't save your preferences.") };
  revalidatePath("/account/profile");
  return {
    ok: true,
    message: Object.values(prefs).some(Boolean)
      ? "Preferences saved. Important service messages about your cover may still be sent."
      : "Preferences saved. You'll still see updates here, and we may send essential service messages about your cover.",
  };
}

const Optional = z.enum(["marketing", "ai_assistance"]);

/** Record a new consent decision (append-only history; withdrawing inserts granted=false). */
export async function setConsent(type: string, granted: boolean): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const t = Optional.safeParse(type);
  if (!t.success) return { ok: false, error: "This consent can't be changed here." };
  const version = (await getSetting<string>("privacy_version")) ?? "unversioned";
  const h = await headers();
  const { error } = await supabase.from("consents").insert({
    user_id: user.id,
    type: t.data,
    version,
    granted,
    context: "profile",
    user_agent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (error) return { ok: false, error: dbError(error, "We couldn't record your choice.") };
  revalidatePath("/account/profile");
  return { ok: true, message: granted ? "Consent given." : "Consent withdrawn." };
}
