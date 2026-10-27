import { en, type MessageKey } from "./en";
import { ee } from "./ee";
import { gaa } from "./gaa";
import { tw } from "./tw";
import { formatMessage, type MessageVars } from "./format";
import { DEFAULT_LOCALE, isLocale, statusFromCoverage, type Locale, type LocaleStatus } from "./locales";
import type { Catalogue, Messages, TranslationRow } from "./types";

/** Code catalogues per locale (English is complete by definition). */
export const CATALOGUES: Record<Locale, Catalogue> = { en, tw, gaa, ee };

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

// ---------------------------------------------------------------------------
// Missing-key reporting
// ---------------------------------------------------------------------------
export interface MissingKeyEvent {
  locale: string;
  key: string;
  /** `key` = not in the English catalogue (a bug); `translation` = English fallback used. */
  kind: "key" | "translation" | "arg";
  arg?: string;
}
type MissingHandler = (e: MissingKeyEvent) => void;
let missingHandler: MissingHandler | null = null;
const reported = new Set<string>();

/** Install a reporter (e.g. log once per key). Returns the previous handler. */
export function onMissingKey(handler: MissingHandler | null): MissingHandler | null {
  const prev = missingHandler;
  missingHandler = handler;
  return prev;
}

function report(e: MissingKeyEvent) {
  const id = `${e.kind}|${e.locale}|${e.key}|${e.arg ?? ""}`;
  if (reported.has(id)) return;
  if (reported.size > 5000) reported.clear();
  reported.add(id);
  missingHandler?.(e);
}

/** Keys reported missing so far in this process (useful in tests and the admin coverage view). */
export function reportedMissing(): string[] {
  return [...reported];
}

// ---------------------------------------------------------------------------
// Translate
// ---------------------------------------------------------------------------
export interface TranslateOptions {
  /** Approved runtime strings for `locale` (e.g. from the `translations` table). Win over code. */
  messages?: Messages | null;
  /** Report English fallbacks for non-English locales (default true). */
  reportFallback?: boolean;
}

/** Look up the raw template for `key` in `locale`, or null if only English has it. */
export function lookupTemplate(locale: Locale, key: MessageKey, messages?: Messages | null): string | null {
  if (locale === DEFAULT_LOCALE) return null;
  const runtime = messages?.[key];
  if (typeof runtime === "string" && runtime.trim() !== "") return runtime;
  const coded = CATALOGUES[locale]?.[key];
  if (typeof coded === "string" && coded.trim() !== "") return coded;
  return null;
}

/**
 * Translate `key` into `locale` with `vars`. Falls back to English (and reports it) when the
 * locale has no translation; returns the key itself (and reports it) if English lacks it too.
 */
export function t(locale: Locale | string, key: MessageKey | string, vars?: MessageVars, opts: TranslateOptions = {}): string {
  const loc: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (!isMessageKey(key)) {
    report({ locale: loc, key, kind: "key" });
    return key;
  }
  const localised = lookupTemplate(loc, key, opts.messages);
  if (!localised && loc !== DEFAULT_LOCALE && opts.reportFallback !== false) report({ locale: loc, key, kind: "translation" });
  const template = localised ?? en[key];
  const formatLocale = localised ? loc : DEFAULT_LOCALE;
  return formatMessage(formatLocale, template, vars, { onMissingArg: (arg) => report({ locale: loc, key, kind: "arg", arg }) });
}

export type Translator = (key: MessageKey, vars?: MessageVars) => string;

/** Bind a locale (and optional runtime strings) once: `const tr = createTranslator("tw", msgs); tr("nav.claims")`. */
export function createTranslator(locale: Locale | string, messages?: Messages | null): Translator & { locale: Locale } {
  const loc: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const fn = ((key: MessageKey, vars?: MessageVars) => t(loc, key, vars, { messages })) as Translator & { locale: Locale };
  fn.locale = loc;
  return fn;
}

// ---------------------------------------------------------------------------
// Catalogue merging and coverage (admin + API)
// ---------------------------------------------------------------------------
/**
 * Merge the code catalogue for `locale` with approved runtime rows into the flat map clients
 * receive. Unknown keys and empty values are dropped; English is never included (clients have it).
 */
export function mergeCatalogue(locale: Locale, rows: readonly TranslationRow[] = []): Messages {
  const out: Messages = {};
  if (locale === DEFAULT_LOCALE) return out;
  for (const [k, v] of Object.entries(CATALOGUES[locale] ?? {})) if (typeof v === "string" && v.trim()) out[k] = v;
  for (const r of rows) {
    if (!isMessageKey(r.key)) continue;
    if (r.status && r.status !== "approved") continue;
    if (typeof r.value === "string" && r.value.trim()) out[r.key] = r.value;
  }
  return out;
}

export interface Coverage {
  locale: Locale;
  total: number;
  translated: number;
  pct: number;
  status: LocaleStatus;
  missing: MessageKey[];
}

/** How much of the English catalogue `messages` (merged, approved) covers. */
export function catalogueCoverage(locale: Locale, messages: Messages): Coverage {
  const total = MESSAGE_KEYS.length;
  if (locale === DEFAULT_LOCALE) return { locale, total, translated: total, pct: 100, status: "complete", missing: [] };
  const missing = MESSAGE_KEYS.filter((k) => !(typeof messages[k] === "string" && messages[k].trim()));
  const translated = total - missing.length;
  return { locale, total, translated, pct: total ? Math.floor((translated / total) * 1000) / 10 : 0, status: statusFromCoverage(translated, total), missing };
}

/**
 * Effective status, measured from what is actually approved — we never claim more than exists.
 * English is always complete.
 */
export function effectiveStatus(locale: Locale, messages: Messages): LocaleStatus {
  if (locale === DEFAULT_LOCALE) return "complete";
  return catalogueCoverage(locale, messages).status;
}
