"use client";

import * as React from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  createTranslator,
  localeDef,
  normaliseLocale,
  type Locale,
  type LocaleStatus,
  type MessageKey,
  type MessageVars,
  type Messages,
  type Translator,
} from "@im/core";

/**
 * Client side of the translation layer.
 *
 * - The locale comes from the `covva_lang` cookie (the visitor's explicit choice), else the
 *   server-resolved locale passed to <I18nProvider> (signed-in profile / Accept-Language), else
 *   English. During SSR and hydration the server value is used, so static shells render
 *   English byte-for-byte and switch after hydration — no hydration mismatch.
 * - English strings are bundled (packages/core/src/i18n/en.ts). Other locales load their
 *   approved strings once from `GET /api/v1/i18n/{locale}` (cached server-side).
 */
export const LOCALE_EVENT = "covva:lang";

type CatalogueState = { status: LocaleStatus; messages: Messages };
interface Ctx {
  locale: Locale;
  catalogue: CatalogueState | null;
}
const I18nContext = React.createContext<Ctx | null>(null);

// ---------------------------------------------------------------------------
// Cookie-backed locale store
// ---------------------------------------------------------------------------
export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  return m ? normaliseLocale(decodeURIComponent(m[1] ?? "")) : null;
}

function subscribeLocale(cb: () => void) {
  window.addEventListener(LOCALE_EVENT, cb);
  return () => window.removeEventListener(LOCALE_EVENT, cb);
}

/** Store the choice (1 year, functional cookie), update `<html lang>` and notify every `useT`. */
export function chooseLocale(code: Locale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${code}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${secure}`;
  document.documentElement.lang = localeDef(code).htmlLang;
  window.dispatchEvent(new Event(LOCALE_EVENT));
}

// ---------------------------------------------------------------------------
// Catalogue store (non-English approved strings)
// ---------------------------------------------------------------------------
const catalogues = new Map<Locale, CatalogueState>();
const inflight = new Set<Locale>();
const catalogueListeners = new Set<() => void>();

function emitCatalogues() {
  for (const l of catalogueListeners) l();
}
function subscribeCatalogues(cb: () => void) {
  catalogueListeners.add(cb);
  return () => catalogueListeners.delete(cb);
}

function loadCatalogue(locale: Locale) {
  if (locale === DEFAULT_LOCALE || catalogues.has(locale) || inflight.has(locale)) return;
  inflight.add(locale);
  fetch(`/api/v1/i18n/${locale}`, { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((json: { ok?: boolean; data?: { status?: LocaleStatus; messages?: Messages } } | null) => {
      const data = json?.ok ? json.data : null;
      catalogues.set(locale, { status: data?.status ?? localeDef(locale).status, messages: data?.messages ?? {} });
    })
    .catch(() => catalogues.set(locale, { status: localeDef(locale).status, messages: {} }))
    .finally(() => {
      inflight.delete(locale);
      emitCatalogues();
    });
}

// ---------------------------------------------------------------------------
// Provider and hooks
// ---------------------------------------------------------------------------
/** Optional: dynamic (request-time) areas pass the server-resolved locale + approved strings. */
export function I18nProvider({ locale, messages, status, children }: { locale: Locale; messages?: Messages; status?: LocaleStatus; children: React.ReactNode }) {
  const value = React.useMemo<Ctx>(
    () => ({ locale, catalogue: locale === DEFAULT_LOCALE ? null : { status: status ?? localeDef(locale).status, messages: messages ?? {} } }),
    [locale, messages, status],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The active locale (cookie → provider → English). English during SSR unless a provider says otherwise. */
export function useLocale(): Locale {
  const ctx = React.useContext(I18nContext);
  const fallback = ctx?.locale ?? DEFAULT_LOCALE;
  return React.useSyncExternalStore(
    subscribeLocale,
    () => readLocaleCookie() ?? fallback,
    () => fallback,
  );
}

function useCatalogue(locale: Locale): CatalogueState | null {
  const ctx = React.useContext(I18nContext);
  const fromCtx = ctx && ctx.locale === locale ? ctx.catalogue : null;
  const loaded = React.useSyncExternalStore(
    subscribeCatalogues,
    () => catalogues.get(locale) ?? null,
    () => null,
  );
  React.useEffect(() => {
    if (!fromCtx) loadCatalogue(locale);
  }, [locale, fromCtx]);
  return fromCtx ?? loaded;
}

/** Status of the active locale as measured by the server (falls back to the declared status). */
export function useLocaleStatus(): { locale: Locale; status: LocaleStatus } {
  const locale = useLocale();
  const cat = useCatalogue(locale);
  return { locale, status: locale === DEFAULT_LOCALE ? "complete" : (cat?.status ?? localeDef(locale).status) };
}

/** `const t = useT(); t("nav.claims")` — English fallback for anything untranslated. */
export function useT(): Translator & { locale: Locale } {
  const locale = useLocale();
  const cat = useCatalogue(locale);
  const messages = cat?.messages ?? null;
  return React.useMemo(() => createTranslator(locale, messages), [locale, messages]);
}

/** Inline translated text for Server or Client Components: `<T k="nav.claims" />`. */
export function T({ k, vars }: { k: MessageKey; vars?: MessageVars }) {
  const t = useT();
  return <>{t(k, vars)}</>;
}
