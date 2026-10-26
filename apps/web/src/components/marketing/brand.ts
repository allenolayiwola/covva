import "server-only";
import { cacheLife } from "next/cache";
import { getFlags, getSetting } from "@/lib/catalog";

/**
 * Brand details are config-driven (`platform_settings.brand`) because
 * "COVVA" is the brand name (configurable in platform settings). Every read goes through the
 * cached catalogue helpers so marketing pages stay prerenderable.
 */
export interface Brand {
  name: string;
  tagline: string;
  supportEmail: string;
  supportPhone: string | null;
  workingName: boolean;
}

const DEFAULT_BRAND: Brand = {
  name: "COVVA",
  tagline: "Insurance made clearer. Human help built in.",
  supportEmail: "support@covva.com.gh",
  supportPhone: null,
  workingName: false,
};

type BrandSetting = Partial<{ name: string; tagline: string; support_email: string; support_phone: string; working_name: boolean }>;

export async function getBrand(): Promise<Brand> {
  const s = await getSetting<BrandSetting>("brand").catch(() => null);
  if (!s) return DEFAULT_BRAND;
  const phone = s.support_phone && !s.support_phone.startsWith("[") ? s.support_phone : null;
  return {
    name: s.name || DEFAULT_BRAND.name,
    tagline: s.tagline || DEFAULT_BRAND.tagline,
    supportEmail: s.support_email || DEFAULT_BRAND.supportEmail,
    supportPhone: phone,
    workingName: s.working_name ?? false,
  };
}

/** True while the `demo_mode` flag is on: demo partners are shown with a DemoBadge. */
export async function isDemoMode(): Promise<boolean> {
  const flags = await getFlags().catch(() => ({}) as Record<string, boolean>);
  return flags.demo_mode ?? true;
}

/** Current year, cached so it can sit in a prerendered shell (no `new Date()` during render). */
export async function getCurrentYear(): Promise<number> {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

/** Demo partner names carry a "(Demo)" suffix in the DB; we show a DemoBadge instead. */
export function displayOrgName(name: string): string {
  return name.replace(/\s*\(demo\)\s*$/i, "").trim();
}

export function isDemoOrg(settings: unknown): boolean {
  return !!settings && typeof settings === "object" && (settings as { demo?: unknown }).demo === true;
}
