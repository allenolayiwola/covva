"use client";

import * as React from "react";
import { Languages } from "lucide-react";
import { Notice, Select, cn } from "@im/ui";
import { LOCALE_COOKIE } from "@im/core";
import { LOCALE_EVENT, chooseLocale, readLocaleCookie } from "@/lib/i18n/client";
import { saveProfileLocale } from "@/components/locale-switcher";
import { ARTICLE_LANGUAGES, type ArticleLanguage } from "./articles";

export const LANG_COOKIE = LOCALE_COOKIE;

function readLang(): ArticleLanguage {
  return (readLocaleCookie() as ArticleLanguage | null) ?? "en";
}
function writeLang(code: ArticleLanguage) {
  // Same cookie and event as the site-wide header switcher, so both stay in sync.
  chooseLocale(code);
  saveProfileLocale(code);
}
function subscribe(cb: () => void) {
  window.addEventListener(LOCALE_EVENT, cb);
  return () => window.removeEventListener(LOCALE_EVENT, cb);
}

/**
 * Honest language switcher for the Learn hub. Only English articles exist today: the choice is stored
 * in the `covva_lang` cookie (shared with the site-wide header switcher) and the page says plainly
 * that Twi, Ga and Ewe articles are coming — nothing is machine-translated.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const lang = React.useSyncExternalStore(subscribe, readLang, () => "en" as ArticleLanguage);
  const uid = React.useId();
  const meta = ARTICLE_LANGUAGES.find((l) => l.code === lang) ?? ARTICLE_LANGUAGES[0];
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3">
        <label htmlFor={uid} className="inline-flex items-center gap-2 text-sm font-medium text-ink-2">
          <Languages aria-hidden className="size-4 text-brand" /> Language
        </label>
        <Select id={uid} value={lang} onChange={(e) => writeLang(e.target.value as ArticleLanguage)} className="h-10 w-auto min-w-[160px]">
          {ARTICLE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}{l.available ? "" : " — coming soon"}
            </option>
          ))}
        </Select>
      </div>
      {!meta.available && (
        <Notice tone="wait">
          <span role="status">{meta.label} translations are coming soon. We have saved your preference and will show {meta.label} as soon as our translators finish — for now this article is in English.</span>
        </Notice>
      )}
    </div>
  );
}
