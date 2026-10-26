"use client";

import * as React from "react";
import { Languages } from "lucide-react";
import { Notice, Select, cn } from "@im/ui";
import { ARTICLE_LANGUAGES, type ArticleLanguage } from "./articles";

export const LANG_COOKIE = "covva_lang";
const EVENT = "covva:lang";

function readLang(): ArticleLanguage {
  const m = document.cookie.match(/(?:^|;\s*)covva_lang=(en|tw|ga|ee)/);
  return (m?.[1] as ArticleLanguage | undefined) ?? "en";
}
function writeLang(code: ArticleLanguage) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${code}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/**
 * Honest language switcher for the Learn hub. Only English content exists today: the choice is stored
 * in the `covva_lang` cookie and the page says plainly that Twi, Ga and Ewe are coming — nothing is
 * machine-translated.
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
