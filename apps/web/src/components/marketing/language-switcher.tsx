"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { Select, cn } from "@im/ui";
import { LOCALE_COOKIE, isCmsLocale, type CmsLocale } from "@im/core";
import { LOCALE_EVENT, chooseLocale, readLocaleCookie } from "@/lib/i18n/client";
import { saveProfileLocale } from "@/components/locale-switcher";
import { ARTICLE_LANGUAGES } from "./articles";

export const LANG_COOKIE = LOCALE_COOKIE;

function readLang(): CmsLocale {
  const v = readLocaleCookie();
  return isCmsLocale(v) ? v : "en";
}
function subscribe(cb: () => void) {
  window.addEventListener(LOCALE_EVENT, cb);
  return () => window.removeEventListener(LOCALE_EVENT, cb);
}

/**
 * The reader's chosen Learn language: the `covva_lang` cookie when it names a CMS locale, else
 * English. "en" during SSR and hydration, so prerendered pages render English byte-for-byte and
 * switch after hydration (and whenever the cookie changes).
 */
export function useLearnLang(): CmsLocale {
  return React.useSyncExternalStore(subscribe, readLang, () => "en" as CmsLocale);
}

/**
 * Language switcher for the Learn hub. It lists only languages that have published content in the
 * CMS (`available`, computed on the server) and renders nothing while English is the only one — no
 * "coming soon" promises. The choice is kept in the `covva_lang` cookie, shared with the site-wide
 * header switcher. On the hub the article cards (`LearnArticleLink`) follow the cookie, so choosing
 * a language makes every card open the translation route. On an article page it also navigates:
 * English at /learn/<slug>, a translation at /learn/<slug>/<lang>; an article without that
 * translation shows English with a notice.
 */
export function LanguageSwitcher({ available, slug, current, className }: { available: readonly CmsLocale[]; slug?: string; current?: CmsLocale; className?: string }) {
  const router = useRouter();
  const cookieLang = useLearnLang();
  const uid = React.useId();
  const options = ARTICLE_LANGUAGES.filter((l) => available.includes(l.code));
  if (options.length < 2) return null;
  const value = current ?? cookieLang;

  function onChange(code: CmsLocale) {
    chooseLocale(code);
    saveProfileLocale(code);
    if (slug) router.push(code === "en" ? `/learn/${slug}` : `/learn/${slug}/${code}`);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3">
        <label htmlFor={uid} className="inline-flex items-center gap-2 text-sm font-medium text-ink-2">
          <Languages aria-hidden className="size-4 text-brand" /> Language
        </label>
        <Select id={uid} value={value} onChange={(e) => onChange(e.target.value as CmsLocale)} className="h-10 w-auto min-w-[160px]">
          {options.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
