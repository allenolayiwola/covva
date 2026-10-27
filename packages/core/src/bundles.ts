/**
 * Product bundles (e.g. the diaspora "Parents' Care Pack"): a curated set of cover types that
 * is requested together. Each item becomes its own request / quote with a participating
 * insurer; the bundle discount only applies to the indicative bundle total and is confirmed
 * by the insurer(s) on the binding quotes. Covva prices nothing itself.
 */
export interface BundleItem {
  category_slug: string;
  product_code?: string;
  required: boolean;
}

export interface BundleDefinition {
  slug: string;
  name: string;
  items: BundleItem[];
  /** Indicative bundle discount in % (0–100). */
  discount_pct: number;
}

export interface BundleLine {
  category_slug: string;
  product_code?: string;
  required: boolean;
  /** Indicative premium for this item (GHS), or null when no estimate exists yet. */
  premium: number | null;
  included: boolean;
}

export interface BundleQuoteResult {
  lines: BundleLine[];
  /** Sum of the included lines' premiums before discount. */
  subtotal: number;
  discountPct: number;
  discount: number;
  total: number;
  /** True when every required item has an estimate. */
  complete: boolean;
  /** Category slugs without an estimate. */
  missing: string[];
  currency: "GHS";
  indicative: true;
}

const round2 = (n: number) => Math.floor(n * 100 + 0.5 + 1e-9) / 100;

/** Parse the `product_bundles.items` JSON defensively (unknown shapes are dropped). */
export function parseBundleItems(raw: unknown): BundleItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BundleItem[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const slug = typeof o.category_slug === "string" ? o.category_slug.trim() : "";
    if (!slug) continue;
    out.push({ category_slug: slug, product_code: typeof o.product_code === "string" && o.product_code ? o.product_code : undefined, required: o.required === true });
  }
  return out;
}

/**
 * Indicative bundle total from per-category estimates (GHS). Items without an estimate are
 * listed as `included: false` and reported in `missing`; the discount applies to what is priced.
 */
export function bundleQuote(bundle: Pick<BundleDefinition, "items" | "discount_pct">, estimatesByCategory: Record<string, number | null | undefined>): BundleQuoteResult {
  const discountPct = Math.min(100, Math.max(0, Number(bundle.discount_pct) || 0));
  const lines: BundleLine[] = bundle.items.map((it) => {
    const est = estimatesByCategory[it.category_slug];
    const premium = typeof est === "number" && Number.isFinite(est) && est >= 0 ? round2(est) : null;
    return { category_slug: it.category_slug, product_code: it.product_code, required: it.required, premium, included: premium !== null };
  });
  const subtotal = round2(lines.reduce((s, l) => s + (l.premium ?? 0), 0));
  const discount = round2((subtotal * discountPct) / 100);
  const missing = lines.filter((l) => !l.included).map((l) => l.category_slug);
  return {
    lines,
    subtotal,
    discountPct,
    discount,
    total: round2(subtotal - discount),
    complete: lines.filter((l) => l.required).every((l) => l.included),
    missing,
    currency: "GHS",
    indicative: true,
  };
}

// ---------------------------------------------------------------------------
// Sponsor plans: one amount per period for named members ("Parents' Care Pack")
// ---------------------------------------------------------------------------
/** `product_bundles.settings` — composition rules, parsed defensively. */
export interface BundleSettings {
  /** One set of per-member items per named person (e.g. each parent). */
  named_members: { role: string; min: number; max: number } | null;
  /** The sponsor pays one amount per period. */
  cadence: "monthly" | "quarterly" | "annual";
  payer: "sponsor" | "customer";
  /** Category slugs priced once per named member; the rest (e.g. home) are priced once per pack. */
  per_member_items: string[];
}

export function parseBundleSettings(raw: unknown): BundleSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const nm = o.named_members && typeof o.named_members === "object" ? (o.named_members as Record<string, unknown>) : null;
  const min = nm && typeof nm.min === "number" && nm.min >= 0 ? Math.floor(nm.min) : 1;
  const max = nm && typeof nm.max === "number" && nm.max >= min ? Math.floor(nm.max) : Math.max(min, 1);
  const cadence = o.cadence === "quarterly" || o.cadence === "annual" ? o.cadence : "monthly";
  return {
    named_members: nm && typeof nm.role === "string" && nm.role ? { role: nm.role, min, max } : null,
    cadence,
    payer: o.payer === "customer" ? "customer" : "sponsor",
    per_member_items: Array.isArray(o.per_member_items) ? o.per_member_items.filter((x): x is string => typeof x === "string" && !!x) : [],
  };
}

export interface NamedMemberEstimate {
  /** Who the items are for (display only). */
  name: string;
  /** Indicative ANNUAL premium per category (GHS) for this person. */
  estimates: Record<string, number | null | undefined>;
}

export interface BundlePlanLine {
  member: string | null;
  category_slug: string;
  required: boolean;
  /** Annual indicative premium, GHS. */
  annual: number | null;
  included: boolean;
}

export interface BundleSponsorPlan {
  lines: BundlePlanLine[];
  /** Annual subtotal of the included lines, before discount. */
  annualSubtotal: number;
  discountPct: number;
  annualDiscount: number;
  annualTotal: number;
  cadence: BundleSettings["cadence"];
  /** One amount per period the sponsor pays (GHS, half up), i.e. annualTotal / periods per year. */
  perPeriod: number;
  /** Required items (per named member) that have no estimate yet. */
  missing: string[];
  complete: boolean;
  currency: "GHS";
  indicative: true;
}

const PERIODS: Record<BundleSettings["cadence"], number> = { monthly: 12, quarterly: 4, annual: 1 };

/**
 * Compose the pack for named members (each parent gets the per-member items) plus the pack-level items (e.g. the
 * family home) into one indicative amount per period for the sponsor. Pricing stays the insurers': estimates in,
 * sums out. Throws when the number of named members is outside the bundle's rules.
 */
export function bundleSponsorPlan(
  bundle: Pick<BundleDefinition, "items" | "discount_pct">,
  settings: BundleSettings,
  members: NamedMemberEstimate[],
  packEstimates: Record<string, number | null | undefined> = {},
): BundleSponsorPlan {
  const rules = settings.named_members;
  if (rules && (members.length < rules.min || members.length > rules.max)) {
    throw new RangeError(`This pack covers ${rules.min === rules.max ? rules.min : `${rules.min} to ${rules.max}`} ${rules.role}${rules.max === 1 ? "" : "s"}.`);
  }
  const perMember = new Set(settings.per_member_items);
  const lines: BundlePlanLine[] = [];
  const toLine = (member: string | null, it: BundleItem, est: number | null | undefined): BundlePlanLine => {
    const annual = typeof est === "number" && Number.isFinite(est) && est >= 0 ? round2(est) : null;
    return { member, category_slug: it.category_slug, required: it.required, annual, included: annual !== null };
  };
  for (const it of bundle.items) {
    if (perMember.has(it.category_slug) && rules) {
      for (const m of members) lines.push(toLine(m.name, it, m.estimates[it.category_slug]));
    } else {
      lines.push(toLine(null, it, packEstimates[it.category_slug]));
    }
  }
  const discountPct = Math.min(100, Math.max(0, Number(bundle.discount_pct) || 0));
  const annualSubtotal = round2(lines.reduce((s, l) => s + (l.annual ?? 0), 0));
  const annualDiscount = round2((annualSubtotal * discountPct) / 100);
  const annualTotal = round2(annualSubtotal - annualDiscount);
  const missing = [...new Set(lines.filter((l) => l.required && !l.included).map((l) => l.category_slug))];
  return {
    lines,
    annualSubtotal,
    discountPct,
    annualDiscount,
    annualTotal,
    cadence: settings.cadence,
    perPeriod: Math.floor((annualTotal / PERIODS[settings.cadence]) * 100 + 0.5 + 1e-9) / 100,
    missing,
    complete: missing.length === 0 && lines.some((l) => l.included),
    currency: "GHS",
    indicative: true,
  };
}
