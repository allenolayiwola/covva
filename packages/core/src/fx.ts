/**
 * Multi-currency display for diaspora payers (roadmap Phase 2 "Diaspora core").
 *
 * Money rules:
 *  - The GHS amount is the contract amount: it is what the insurer is owed and receives.
 *    Nothing here changes it. A foreign-currency figure is an INDICATIVE display only.
 *  - Rates are "GHS per 1 unit of the quote currency" (1 GBP = GH₵ 20.50 → rate 20.5).
 *  - Rounding is half up to 2 dp, done in integer minor units so 0.005 never drifts.
 *  - The platform FX margin (platform_settings.fx.margin_pct, default 0) is a display buffer
 *    for the PSP's conversion spread so the indicative amount is not understated. It is shown
 *    to the payer; Covva never collects it — the PSP charges the GHS amount and the card
 *    issuer applies the final rate.
 */
export const SUPPORTED_DISPLAY_CURRENCIES = ["GHS", "GBP", "USD", "EUR", "CAD"] as const;
export type DisplayCurrency = (typeof SUPPORTED_DISPLAY_CURRENCIES)[number];

export const CURRENCY_META: Record<DisplayCurrency, { symbol: string; label: string; locale: string }> = {
  GHS: { symbol: "GH₵", label: "Ghana cedi", locale: "en-GH" },
  GBP: { symbol: "£", label: "British pound", locale: "en-GB" },
  USD: { symbol: "$", label: "US dollar", locale: "en-US" },
  EUR: { symbol: "€", label: "Euro", locale: "en-IE" },
  CAD: { symbol: "C$", label: "Canadian dollar", locale: "en-CA" },
};

export type FxSource = "manual" | "openexchangerates" | "bog" | "provider";
export const FX_SOURCE_LABEL: Record<FxSource, string> = {
  manual: "manual rate set by Covva operations",
  openexchangerates: "Open Exchange Rates",
  bog: "Bank of Ghana",
  provider: "payment provider rate",
};

export function isDisplayCurrency(v: unknown): v is DisplayCurrency {
  return typeof v === "string" && (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(v.toUpperCase()) && v === v.toUpperCase();
}

/** Normalise user input ("gbp", " GBP ") to a supported code, else null. */
export function parseDisplayCurrency(v: unknown): DisplayCurrency | null {
  if (typeof v !== "string") return null;
  const code = v.trim().toUpperCase();
  return (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(code) ? (code as DisplayCurrency) : null;
}

/** Round half up to 2 dp (money). Uses integer arithmetic with a tiny epsilon so 1.005 → 1.01. */
export function roundHalfUp(n: number, dp = 2): number {
  if (!Number.isFinite(n)) throw new RangeError("Amount must be a finite number");
  const f = 10 ** dp;
  const sign = n < 0 ? -1 : 1;
  const scaled = Math.abs(n) * f;
  return (sign * Math.floor(scaled + 0.5 + 1e-9)) / f;
}

function assertRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError("FX rate must be a positive number (GHS per 1 unit)");
}

/** Foreign amount → GHS. `rate` = GHS per 1 unit of the foreign currency. 2 dp, half up. */
export function convertToGhs(amount: number, rate: number): number {
  assertRate(rate);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Amount must not be negative");
  return roundHalfUp(amount * rate);
}

/** GHS → foreign amount (indicative). `rate` = GHS per 1 unit of the foreign currency. 2 dp, half up. */
export function convertFromGhs(ghsAmount: number, rate: number): number {
  assertRate(rate);
  if (!Number.isFinite(ghsAmount) || ghsAmount < 0) throw new RangeError("Amount must not be negative");
  return roundHalfUp(ghsAmount / rate);
}

/**
 * The payer-facing rate after the platform FX margin: fewer GHS per unit, so the indicative
 * foreign amount is slightly higher. `marginPct` 0 → unchanged. Clamped to [0, 10] %.
 */
export function fxMargin(rate: number, marginPct: number | null | undefined): number {
  assertRate(rate);
  const pct = Math.min(10, Math.max(0, Number(marginPct) || 0));
  return pct === 0 ? rate : rate / (1 + pct / 100);
}

export interface FxQuote {
  displayCurrency: DisplayCurrency;
  /** GHS contract amount (what the insurer receives). */
  ghsAmount: number;
  /** Indicative amount in `displayCurrency` (equals ghsAmount for GHS). */
  displayAmount: number;
  /** Rate used for the display, after the margin (GHS per 1 unit). 1 for GHS. */
  rate: number;
  /** Provider rate before the margin. */
  baseRate: number;
  marginPct: number;
  source: FxSource;
  quotedAt: string;
  indicative: true;
  disclosure: string;
}

/** Build the display quote for a GHS amount. GHS in → identity (rate 1, no disclosure caveat about conversion). */
export function fxQuote(input: { ghsAmount: number; displayCurrency: DisplayCurrency; rate?: number; source?: FxSource; quotedAt?: string | Date; marginPct?: number | null }): FxQuote {
  const ghsAmount = roundHalfUp(input.ghsAmount);
  const quotedAt = input.quotedAt instanceof Date ? input.quotedAt.toISOString() : (input.quotedAt ?? new Date(0).toISOString());
  const source = input.source ?? "manual";
  if (input.displayCurrency === "GHS") {
    return { displayCurrency: "GHS", ghsAmount, displayAmount: ghsAmount, rate: 1, baseRate: 1, marginPct: 0, source, quotedAt, indicative: true, disclosure: `You pay ${formatMoney(ghsAmount, "GHS")} to the insurer. Covva never holds your premium.` };
  }
  const baseRate = input.rate ?? NaN;
  assertRate(baseRate);
  const marginPct = Math.min(10, Math.max(0, Number(input.marginPct) || 0));
  const rate = fxMargin(baseRate, marginPct);
  const displayAmount = convertFromGhs(ghsAmount, rate);
  return {
    displayCurrency: input.displayCurrency,
    ghsAmount,
    displayAmount,
    rate: roundHalfUp(rate, 8),
    baseRate,
    marginPct,
    source,
    quotedAt,
    indicative: true,
    disclosure: fxDisclosure(input.displayCurrency, rate, source, quotedAt, { ghsAmount, displayAmount, marginPct }),
  };
}

/**
 * Plain-language FX disclosure shown next to the price and stored on the payment:
 * "Indicative rate … the insurer receives GHS X".
 */
export function fxDisclosure(displayCurrency: DisplayCurrency, rate: number, source: FxSource, quotedAt: string | Date, opts: { ghsAmount?: number; displayAmount?: number; marginPct?: number } = {}): string {
  if (displayCurrency === "GHS") return "You pay in Ghana cedis. The insurer receives the full premium; Covva never holds it.";
  assertRate(rate);
  const when = formatRateDate(quotedAt);
  const parts = [`Indicative rate: 1 ${displayCurrency} ≈ ${formatMoney(roundHalfUp(rate, 4), "GHS", 4)} (${FX_SOURCE_LABEL[source]}, ${when})`];
  if (opts.ghsAmount !== undefined) {
    const shown = opts.displayAmount ?? convertFromGhs(opts.ghsAmount, rate);
    parts.push(`You pay ≈ ${formatMoney(shown, displayCurrency)}; the insurer receives ${formatMoney(opts.ghsAmount, "GHS")}.`);
  }
  if (opts.marginPct && opts.marginPct > 0) parts.push(`The shown rate includes a ${opts.marginPct}% buffer for the payment provider's conversion spread.`);
  parts.push("Your card issuer or payment provider applies the final exchange rate and may add a foreign transaction fee. The GHS amount is the contract amount.");
  return parts.join(" ");
}

function formatRateDate(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "date unknown";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** `GH₵ 1,234.50`, `£61.25`, `C$108.00`. Symbols from CURRENCY_META; unknown codes fall back to `CODE 1.00`. */
export function formatMoney(amount: number, currency: string, dp = 2): string {
  const code = currency.toUpperCase();
  const meta = (CURRENCY_META as Record<string, { symbol: string }>)[code];
  const n = Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const sign = amount < 0 ? "−" : "";
  if (!meta) return `${sign}${code} ${n}`;
  return code === "GHS" ? `${sign}${meta.symbol} ${n}` : `${sign}${meta.symbol}${n}`;
}

/** "You pay ≈ £61.25 (indicative) · Insurer receives GH₵ 1,255.63" — the checkout line. */
export function fxSummaryLine(q: Pick<FxQuote, "displayCurrency" | "displayAmount" | "ghsAmount">): string {
  if (q.displayCurrency === "GHS") return `You pay ${formatMoney(q.ghsAmount, "GHS")} · Insurer receives ${formatMoney(q.ghsAmount, "GHS")}`;
  return `You pay ≈ ${formatMoney(q.displayAmount, q.displayCurrency)} (indicative) · Insurer receives ${formatMoney(q.ghsAmount, "GHS")}`;
}
