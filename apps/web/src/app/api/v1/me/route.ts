import { after } from "next/server";
import { UpdateProfileInput, currencyForCountry, parseActiveWorkspace, timezoneForCountry } from "@im/core";
import type { Update } from "@im/db";
import { getFlags, getSetting } from "@/lib/catalog";
import { check, must, parseJson, withApi } from "@/server/api-auth";
import { buildWorkspaces, resolveActiveWorkspace } from "@/server/workspaces";

/** GET /api/v1/me — profile, memberships, workspaces, feature flags and current terms versions. */
export const GET = withApi(
  async ({ auth, client }) => {
    const sb = auth.supabase;
    const [profile, { data: memberships }, flags, terms, privacy, { data: consents }] = await Promise.all([
      sb.from("profiles").select("*").eq("id", auth.userId).maybeSingle().then((r) => must(r, "Profile not found.")),
      sb
        .from("memberships")
        .select("id, org_id, role, team, title, is_supervisor, org:organizations!memberships_org_id_fkey(id, name, slug, type, status, nic_licence_number, logo_url, settings)")
        .eq("user_id", auth.userId)
        .eq("active", true),
      getFlags(),
      getSetting<string>("terms_version"),
      getSetting<string>("privacy_version"),
      sb.from("consents").select("type, version, granted, created_at").eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(100),
    ]);
    // Latest decision per consent type.
    const latest: Record<string, { version: string; granted: boolean; at: string }> = {};
    for (const c of consents ?? []) latest[c.type] ??= { version: c.version, granted: c.granted, at: c.created_at };
    const { ghana_card_number, ...rest } = profile;
    // Diaspora: the sponsor's household (family group) and how many family members they look after.
    const [{ data: household }, { count: beneficiaryCount }] = await Promise.all([
      sb.from("households").select("id, name, created_at").eq("owner_user_id", auth.userId).maybeSingle(),
      sb.from("beneficiaries").select("id", { count: "exact", head: true }).eq("sponsor_user_id", auth.userId),
    ]);
    const workspaces = buildWorkspaces(memberships ?? [], client);
    const activeWorkspace = resolveActiveWorkspace(parseActiveWorkspace(profile.active_workspace), workspaces);
    // Remember which platform this account last used (non-blocking; a GET must not wait on a write).
    if (profile.last_seen_platform !== client) {
      after(async () => {
        await sb.from("profiles").update({ last_seen_platform: client }).eq("id", auth.userId);
      });
    }
    return {
      profile: { ...rest, ghana_card_last4: ghana_card_number ? ghana_card_number.slice(-4) : null },
      country: profile.country_code ?? "GH",
      currency: profile.preferred_currency ?? "GHS",
      timezone: profile.timezone ?? null,
      isSponsor: !!profile.is_sponsor || (beneficiaryCount ?? 0) > 0,
      household: household ? { ...household, beneficiaries: beneficiaryCount ?? 0 } : null,
      memberships: memberships ?? [],
      isPartner: (memberships ?? []).some((m) => ["broker", "insurer"].includes((m.org as unknown as { type: string } | null)?.type ?? "")),
      workspaces,
      activeWorkspace,
      client,
      flags,
      consents: latest,
      versions: { terms: terms ?? null, privacy: privacy ?? null },
      needsConsent: !latest.terms?.granted || latest.terms.version !== terms || !latest.privacy?.granted || latest.privacy.version !== privacy,
    };
  },
  { auth: "user" },
);

/** PATCH /api/v1/me — update own profile (KYC status is never client-writable). */
export const PATCH = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, UpdateProfileInput);
    const patch: Update<"profiles"> = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    if (input.preferredName !== undefined) patch.preferred_name = input.preferredName;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.accountType !== undefined) patch.account_type = input.accountType;
    if (input.businessName !== undefined) patch.business_name = input.businessName;
    if (input.dateOfBirth !== undefined) patch.date_of_birth = input.dateOfBirth;
    if (input.ghanaCardNumber !== undefined) patch.ghana_card_number = input.ghanaCardNumber?.toUpperCase() ?? null;
    if (input.region !== undefined) patch.region = input.region;
    if (input.city !== undefined) patch.city = input.city;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;
    if (input.countryCode !== undefined) {
      patch.country_code = input.countryCode;
      patch.is_sponsor = input.countryCode !== "GH" ? true : undefined;
      if (input.preferredCurrency === undefined) patch.preferred_currency = currencyForCountry(input.countryCode);
      if (input.timezone === undefined) patch.timezone = timezoneForCountry(input.countryCode);
    }
    if (input.preferredCurrency !== undefined) patch.preferred_currency = input.preferredCurrency;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.onboarded) patch.onboarded_at = new Date().toISOString();
    if (input.notificationPrefs) {
      const { data: cur } = await auth.supabase.from("profiles").select("notification_prefs").eq("id", auth.userId).single();
      patch.notification_prefs = { ...((cur?.notification_prefs as Record<string, boolean>) ?? {}), ...input.notificationPrefs };
      // WhatsApp is an explicit opt-in (renewal reminders, quote links); keep the flag in step with the preference.
      if (typeof input.notificationPrefs.whatsapp === "boolean") patch.whatsapp_opt_in = input.notificationPrefs.whatsapp;
    }
    if (!Object.keys(patch).length) return { updated: false };
    const res = await auth.supabase.from("profiles").update(patch).eq("id", auth.userId).select("id, full_name, preferred_name, phone, account_type, business_name, region, city, locale, avatar_url, notification_prefs, onboarded_at, kyc_status, country_code, preferred_currency, timezone, is_sponsor").single();
    check(res);
    return { updated: true, profile: res.data };
  },
  { auth: "user" },
);
