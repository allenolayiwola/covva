import "server-only";
import { SUPPORTED_DISPLAY_CURRENCIES, fxQuote, parseDisplayCurrency, type DisplayCurrency, type FxQuote, type FxSource } from "@im/core";
import type { Json } from "@im/db";
import { createPublicClient, createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError } from "@/server/requests";
import { log } from "@/server/log";

/**
 * FX display rates for diaspora payers (roadmap Phase 2). Rates are "GHS per 1 unit" and are
 * INDICATIVE: the insurer is always paid the GHS contract amount; the PSP / card issuer applies
 * the final rate. Reads come from `fx_rates` (public, append-only); refreshes are done by the
 * `fx-rates` cron through a provider abstraction:
 *
 *   FX_PROVIDER (or platform_settings.fx.provider) = manual (default, no-op) | openexchangerates | bog
 *   OPENEXCHANGERATES_APP_ID — key for https://openexchangerates.org (free tier: USD base, hourly)
 *   platform_settings.fx.margin_pct — display buffer for the PSP's conversion spread (default 0)
 */
type Svc = ReturnType<typeof createServiceClient>;

export interface FxRate {
  quote: DisplayCurrency;
  /** GHS per 1 unit of `quote`. */
  rate: number;
  source: FxSource;
  fetchedAt: string;
  validUntil: string | null;
  /** True when the newest rate is a manual seed/override (flagged in the UI). */
  manual: boolean;
}

export interface FxSettings {
  marginPct: number;
  provider: "manual" | "openexchangerates" | "bog";
}

const TTL_MS = 60_000;
const rateCache = new Map<string, { at: number; value: FxRate }>();
let settingsCache: { at: number; value: FxSettings } | null = null;

const GHS_RATE: FxRate = { quote: "GHS", rate: 1, source: "manual", fetchedAt: new Date(0).toISOString(), validUntil: null, manual: false };

function asObject(v: Json | null | undefined): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Platform FX settings (`platform_settings.fx`), cached for a minute. `FX_PROVIDER` env wins over the setting. */
export async function fxSettings(): Promise<FxSettings> {
  if (settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.value;
  let value: FxSettings = { marginPct: 0, provider: "manual" };
  try {
    const { data } = await createPublicClient().from("platform_settings").select("value").eq("key", "fx").maybeSingle();
    const o = asObject(data?.value);
    const margin = Math.min(10, Math.max(0, Number(o.margin_pct) || 0));
    const p = String(process.env.FX_PROVIDER ?? o.provider ?? "manual").toLowerCase();
    value = { marginPct: margin, provider: p === "openexchangerates" || p === "bog" ? p : "manual" };
  } catch (err) {
    log.warn("fx.settings_failed", { err });
  }
  settingsCache = { at: Date.now(), value };
  return value;
}

/** Latest rate for a display currency (GHS → 1). Throws a business rule when none is stored yet. */
export async function getRate(quote: DisplayCurrency | string): Promise<FxRate> {
  const code = parseDisplayCurrency(quote);
  if (!code) throw new BusinessRuleError(`Currency ${String(quote)} is not supported. Choose GHS, GBP, USD, EUR or CAD.`, "invalid_input");
  if (code === "GHS") return GHS_RATE;
  const cached = rateCache.get(code);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const { data, error } = await createPublicClient().from("fx_rates").select("quote, rate, source, fetched_at, valid_until").eq("quote", code).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (error) log.warn("fx.rate_read_failed", { quote: code, err: error });
  if (!data) throw new BusinessRuleError(`We don't have an exchange rate for ${code} yet. Pay in GHS or try again later.`, "unavailable");
  const value: FxRate = { quote: code, rate: Number(data.rate), source: data.source as FxSource, fetchedAt: data.fetched_at, validUntil: data.valid_until, manual: data.source === "manual" };
  rateCache.set(code, { at: Date.now(), value });
  return value;
}

/** All supported currencies with their latest rate (null when none is stored). */
export async function getRates(): Promise<Record<DisplayCurrency, FxRate | null>> {
  const out = {} as Record<DisplayCurrency, FxRate | null>;
  for (const c of SUPPORTED_DISPLAY_CURRENCIES) {
    try {
      out[c] = await getRate(c);
    } catch {
      out[c] = null;
    }
  }
  return out;
}

/** Indicative display quote for a GHS amount, including the platform margin and the disclosure text. */
export async function quoteFx(ghsAmount: number, displayCurrency: DisplayCurrency | string): Promise<FxQuote> {
  const code = parseDisplayCurrency(displayCurrency) ?? "GHS";
  if (code === "GHS") return fxQuote({ ghsAmount, displayCurrency: "GHS", quotedAt: new Date() });
  const [rate, settings] = await Promise.all([getRate(code), fxSettings()]);
  return fxQuote({ ghsAmount, displayCurrency: code, rate: rate.rate, source: rate.source, quotedAt: rate.fetchedAt, marginPct: settings.marginPct });
}

/** Clears the in-memory caches (after an admin override in the same instance). */
export function clearFxCache() {
  rateCache.clear();
  settingsCache = null;
}

// ---------------------------------------------------------------------------
// Providers (cron `fx-rates`)
// ---------------------------------------------------------------------------
interface ProviderResult {
  ok: boolean;
  rates?: { quote: DisplayCurrency; rate: number; fetchedAt: string; validUntil: string | null }[];
  message?: string;
}

const FOREIGN = SUPPORTED_DISPLAY_CURRENCIES.filter((c) => c !== "GHS");

async function fetchOpenExchangeRates(): Promise<ProviderResult> {
  const appId = process.env.OPENEXCHANGERATES_APP_ID;
  if (!appId) return { ok: false, message: "OPENEXCHANGERATES_APP_ID is not set" };
  const url = `https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(appId)}&base=USD&symbols=${["GHS", ...FOREIGN].join(",")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { timestamp?: number; rates?: Record<string, number>; description?: string };
  if (!res.ok || !json.rates?.GHS) return { ok: false, message: json.description ?? `Open Exchange Rates returned ${res.status}` };
  const ghsPerUsd = json.rates.GHS;
  const fetchedAt = new Date((json.timestamp ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const validUntil = new Date(Date.parse(fetchedAt) + 2 * 3_600_000).toISOString();
  const rates: NonNullable<ProviderResult["rates"]> = [];
  for (const c of FOREIGN) {
    const perUsd = c === "USD" ? 1 : json.rates[c];
    if (!perUsd) continue;
    rates.push({ quote: c, rate: Math.round((ghsPerUsd / perUsd) * 1e8) / 1e8, fetchedAt, validUntil });
  }
  return { ok: true, rates };
}

/** Bank of Ghana interbank rates — no public JSON feed is integrated yet. */
async function fetchBankOfGhana(): Promise<ProviderResult> {
  return { ok: false, message: "Bank of Ghana rate feed is not integrated yet (FX_PROVIDER=bog). Use openexchangerates or manual overrides." };
}

/**
 * Refresh `fx_rates` from the configured provider. `manual` is a no-op (operations set rates in the
 * admin console). Idempotent: a provider timestamp already stored is skipped (unique quote + fetched_at).
 */
export async function refreshRates(svc: Svc = createServiceClient()): Promise<Record<string, unknown>> {
  const settings = await fxSettings();
  if (settings.provider === "manual") return { provider: "manual", inserted: 0, skipped: 0, note: "manual provider: nothing fetched" };
  const result = settings.provider === "openexchangerates" ? await fetchOpenExchangeRates() : await fetchBankOfGhana();
  if (!result.ok || !result.rates) {
    log.warn("fx.refresh_failed", { provider: settings.provider, message: result.message });
    return { provider: settings.provider, inserted: 0, skipped: 0, error: result.message };
  }
  let inserted = 0;
  let skipped = 0;
  for (const r of result.rates) {
    const { error } = await svc.from("fx_rates").insert({ base: "GHS", quote: r.quote, rate: r.rate, source: settings.provider, fetched_at: r.fetchedAt, valid_until: r.validUntil });
    if (!error) inserted++;
    else if (error.code === "23505") skipped++;
    else log.error("fx.insert_failed", { quote: r.quote, err: error });
  }
  clearFxCache();
  return { provider: settings.provider, inserted, skipped };
}
