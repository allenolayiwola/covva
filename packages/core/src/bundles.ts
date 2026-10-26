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
