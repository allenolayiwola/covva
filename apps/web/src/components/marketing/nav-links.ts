import type { MessageKey } from "@im/core";
import { sitePath } from "@/lib/site-url";

/**
 * Navigation used by the header (desktop + mobile menu). Plain data: safe in client components.
 * `labelKey` / `descriptionKey` point at the i18n catalogue (English text stays in `label` /
 * `description` for code that doesn't translate, and must match the catalogue).
 */
export interface NavLink { href: string; label: string; description?: string; labelKey?: MessageKey; descriptionKey?: MessageKey; /** Desktop header only: show from this breakpoint (always in the mobile menu). */ from?: "lg" | "xl" }
export interface NavGroup { label: string; labelKey?: MessageKey; items: NavLink[]; from?: "lg" | "xl" }
export type NavEntry = NavLink | NavGroup;

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

export const INSURANCE_NAV: NavLink[] = [
  { labelKey: "nav.motor.label", descriptionKey: "nav.motor.desc", href: sitePath("/insurance/motor"), label: "Motor", description: "Third party or comprehensive, instant certificate" },
  { labelKey: "nav.home.label", descriptionKey: "nav.home.desc", href: sitePath("/insurance/home"), label: "Home & contents", description: "Fire, flood, burglary — and homes being built" },
  { labelKey: "nav.health.label", descriptionKey: "nav.health.desc", href: sitePath("/insurance/health"), label: "Health", description: "Private plans that work alongside NHIS" },
  { labelKey: "nav.travel.label", descriptionKey: "nav.travel.desc", href: sitePath("/insurance/travel"), label: "Travel", description: "Schengen-compliant cover in minutes" },
  { labelKey: "nav.lifeFuneral.label", descriptionKey: "nav.lifeFuneral.desc", href: sitePath("/insurance/life-funeral"), label: "Life & funeral", description: "Dignity for the family, paid from anywhere" },
  { labelKey: "nav.businessCover.label", descriptionKey: "nav.businessCover.desc", href: sitePath("/insurance/business"), label: "Business", description: "Property, liability, staff and fleet" },
  { labelKey: "nav.micro.label", descriptionKey: "nav.micro.desc", href: sitePath("/insurance/micro"), label: "Micro-insurance", description: "Hospital cash and accident cover by MoMo" },
  { labelKey: "nav.explore.label", descriptionKey: "nav.explore.desc", href: sitePath("/explore"), label: "Explore all cover", description: "Every category and what to compare" },
];

export const PARTNERS_NAV: NavLink[] = [
  { labelKey: "nav.insurers.label", descriptionKey: "nav.insurers.desc", href: sitePath("/insurers"), label: "For insurers", description: "Digital distribution under your control" },
  { labelKey: "nav.brokers.label", descriptionKey: "nav.brokers.desc", href: sitePath("/brokers"), label: "For brokers", description: "Qualified leads, faster payment, a free digital office" },
  { labelKey: "nav.embedded.label", descriptionKey: "nav.embedded.desc", href: sitePath("/partners/embedded"), label: "Embedded partners", description: "Dealers, banks, landlords, fleets, travel agents" },
  { labelKey: "nav.directory.label", descriptionKey: "nav.directory.desc", href: sitePath("/partners"), label: "Partner directory", description: "Licensed insurers and brokers on Covva" },
];

export const PRIMARY_NAV: NavEntry[] = [
  { labelKey: "nav.insurance", label: "Insurance", items: INSURANCE_NAV },
  { href: sitePath("/diaspora"), label: "Diaspora", labelKey: "nav.diaspora" },
  { href: sitePath("/business"), label: "Business", labelKey: "nav.business" },
  { href: sitePath("/claims"), label: "Claims", labelKey: "nav.claims", from: "lg" },
  { href: sitePath("/verify"), label: "Verify", labelKey: "nav.verify", from: "xl" },
  { labelKey: "nav.partners", label: "Partners", items: PARTNERS_NAV },
  { href: sitePath("/learn"), label: "Learn", labelKey: "nav.learn", from: "lg" },
  { href: sitePath("/about"), label: "About", labelKey: "nav.about", from: "xl" },
];

/** "More" links shown in the mobile menu and used by the footer. */
export const SECONDARY_NAV: NavLink[] = [
  { href: sitePath("/get-started"), label: "Help me choose", labelKey: "nav.helpChoose" },
  { href: sitePath("/how-it-works"), label: "How it works", labelKey: "nav.howItWorks" },
  { href: sitePath("/support"), label: "Help centre", labelKey: "nav.helpCentre" },
  { href: sitePath("/trust"), label: "Regulation & protection", labelKey: "nav.trust" },
  { href: sitePath("/referrals"), label: "Refer a friend", labelKey: "nav.referrals" },
  { href: sitePath("/waitlist"), label: "Join the waitlist", labelKey: "nav.waitlist" },
  { href: sitePath("/press"), label: "Press & media kit", labelKey: "nav.press" },
  { href: sitePath("/contact"), label: "Contact", labelKey: "nav.contact" },
];

/** Translated label/description with the English data as the fallback. */
export function navText(t: (key: MessageKey) => string, entry: { label: string; labelKey?: MessageKey; description?: string; descriptionKey?: MessageKey }) {
  return {
    label: entry.labelKey ? t(entry.labelKey) : entry.label,
    description: entry.descriptionKey ? t(entry.descriptionKey) : entry.description,
  };
}
