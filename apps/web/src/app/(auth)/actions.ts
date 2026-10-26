"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currencyForCountry, isSponsorCountry, timezoneForCountry } from "@im/core";
import { createClient } from "@/lib/supabase/server";
import { normaliseGhanaPhone, safeNext, type ActionState } from "@/components/customer/utils";
import { siteUrl } from "@/lib/site-url";

async function siteOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && /^https?:\/\//.test(origin)) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  return siteUrl();
}

function authMessage(err: { message?: string; code?: string; status?: number } | null, fallback: string) {
  const m = (err?.message ?? "").toLowerCase();
  if (m.includes("invalid login") || err?.code === "invalid_credentials") return "That email and password don't match. Check them and try again.";
  if (m.includes("email not confirmed")) return "Please confirm your email first — we sent you a link when you signed up.";
  if (m.includes("already registered") || err?.code === "user_already_exists") return "An account already exists for that email. Try signing in instead.";
  if (m.includes("rate limit") || err?.status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("password") && m.includes("characters")) return "Your password needs at least 8 characters.";
  if (m.includes("weak") || err?.code === "weak_password") return "Please choose a stronger password (at least 8 characters, mixing letters and numbers).";
  return fallback;
}

/** Where to go after a successful sign-in: onboarding first if the profile isn't complete. */
async function postSignInPath(next: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return next;
  const { data: profile } = await supabase.from("profiles").select("onboarded_at").eq("id", data.user.id).maybeSingle();
  if (profile && !profile.onboarded_at && !next.startsWith("/partner")) return `/onboarding?next=${encodeURIComponent(next)}`;
  return next;
}

// ---------------------------------------------------------------------------
// Email + password
// ---------------------------------------------------------------------------
const PasswordSignIn = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export async function signInWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = PasswordSignIn.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { ok: false, error: authMessage(error, "We couldn't sign you in. Please try again.") };
  redirect(await postSignInPath(safeNext(parsed.data.next)));
}

// ---------------------------------------------------------------------------
// Email magic link
// ---------------------------------------------------------------------------
export async function sendMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ email: z.string().trim().email("Enter a valid email address"), next: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const next = safeNext(parsed.data.next);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: false },
  });
  if (error) {
    if ((error.message ?? "").toLowerCase().includes("signups not allowed")) {
      return { ok: false, error: "We couldn't find an account for that email. Create one to get started." };
    }
    return { ok: false, error: authMessage(error, "We couldn't send the link. Please try again.") };
  }
  return { ok: true, message: `Check ${parsed.data.email} — we've sent you a sign-in link. It works once and expires in an hour.` };
}

// ---------------------------------------------------------------------------
// Phone OTP (Ghana numbers). SMS may not be configured yet — fail gracefully.
// ---------------------------------------------------------------------------
const SMS_UNAVAILABLE =
  "Text-message sign-in isn't available right now. Please use your email address instead — you can sign in with a password or a one-time email link.";

export async function sendPhoneOtp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const phone = normaliseGhanaPhone(String(formData.get("phone") ?? ""));
  if (!phone) return { ok: false, error: "Enter a Ghana mobile number, for example 024 123 4567." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false, channel: "sms" } });
  if (error) {
    const m = (error.message ?? "").toLowerCase();
    if (m.includes("signups not allowed") || m.includes("user not found")) {
      return { ok: false, error: "We couldn't find an account with that number. Sign in with your email, or create an account." };
    }
    if (error.status === 429) return { ok: false, error: "Too many codes requested. Please wait a minute and try again." };
    return { ok: false, error: SMS_UNAVAILABLE, data: { smsUnavailable: true } };
  }
  return { ok: true, message: `We've sent a 6-digit code to ${phone}.`, data: { phone } };
}

export async function verifyPhoneOtp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const phone = normaliseGhanaPhone(String(formData.get("phone") ?? ""));
  const token = String(formData.get("token") ?? "").replace(/\D/g, "");
  if (!phone) return { ok: false, error: "Enter your Ghana mobile number again." };
  if (token.length < 6) return { ok: false, error: "Enter the 6-digit code from the text message." };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) return { ok: false, error: "That code is incorrect or has expired. Request a new one.", data: { phone } };
  redirect(await postSignInPath(safeNext(formData.get("next"))));
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------
const SignUp = z
  .object({
    full_name: z.string().trim().min(2, "Enter your full name").max(120),
    email: z.string().trim().email("Enter a valid email address"),
    phone: z.string().trim().min(1, "Enter your mobile number"),
    password: z.string().min(8, "Use at least 8 characters").max(72),
    account_type: z.enum(["individual", "business"]),
    business_name: z.string().trim().max(160).optional(),
    /** Diaspora: country of residence (ISO-2, default Ghana). Anything other than GH marks a sponsor. */
    country_code: z.string().trim().regex(/^[A-Za-z]{2}$/).optional().transform((v) => (v ?? "GH").toUpperCase()),
    next: z.string().optional(),
  })
  .refine((v) => v.account_type === "individual" || (v.business_name?.length ?? 0) >= 2, {
    message: "Enter your business name",
    path: ["business_name"],
  });

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = SignUp.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const phone = normaliseGhanaPhone(v.phone);
  if (!phone) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a Ghana number, e.g. 024 123 4567" } };

  const supabase = await createClient();
  const next = safeNext(v.next);
  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(`/onboarding?next=${encodeURIComponent(next)}`)}`,
      data: {
        full_name: v.full_name,
        phone,
        account_type: v.account_type,
        business_name: v.account_type === "business" ? v.business_name : null,
        country_code: v.country_code,
        preferred_currency: currencyForCountry(v.country_code),
        timezone: timezoneForCountry(v.country_code),
        is_sponsor: isSponsorCountry(v.country_code),
      },
    },
  });
  if (error) return { ok: false, error: authMessage(error, "We couldn't create your account. Please try again.") };
  // Supabase returns an obfuscated user with no identities when the email already exists.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { ok: false, error: "An account already exists for that email. Try signing in instead." };
  }
  if (data.session) redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  return {
    ok: true,
    message: `Almost there. We've sent a confirmation link to ${v.email}. Open it on this device to finish setting up your account.`,
  };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ email: z.string().trim().email("Enter a valid email address") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password`,
  });
  if (error && error.status === 429) return { ok: false, error: "Too many requests. Please wait a minute and try again." };
  // Same message whether or not the account exists (no account enumeration).
  return { ok: true, message: `If an account exists for ${parsed.data.email}, you'll get an email with a link to choose a new password.` };
}

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ password: z.string().min(8, "Use at least 8 characters").max(72), confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "The passwords don't match", path: ["confirm"] })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: authMessage(error, "We couldn't update your password. Please try again.") };
  redirect("/account?password=updated");
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in?signed_out=1");
}
