"use client";

import * as React from "react";
import Link from "next/link";
import { Languages } from "lucide-react";
import { localeDef, type CmsLocale } from "@im/core";
import { useLearnLang } from "./language-switcher";

/**
 * A Learn hub card link that follows the reader's chosen language (the `covva_lang` cookie, see
 * `LanguageSwitcher`). English keeps the stable URL /learn/<slug>; a language the hub offers
 * (`available`: locales with at least one translated article) links to /learn/<slug>/<lang>, where
 * a missing translation shows the English text with the "translation in progress" notice. Cards
 * for such articles say so up front. Server-rendered as English, so prerendered HTML never changes.
 */
export function LearnArticleLink({
  slug,
  available,
  translations,
  className,
  children,
}: {
  slug: string;
  /** Locales the hub offers (at least one translated article). */
  available: readonly CmsLocale[];
  /** Locales this article is translated into. */
  translations: readonly CmsLocale[];
  className?: string;
  children: React.ReactNode;
}) {
  const chosen = useLearnLang();
  const lang = chosen !== "en" && available.includes(chosen) ? chosen : "en";
  const href = lang === "en" ? `/learn/${slug}` : `/learn/${slug}/${lang}`;
  const pending = lang !== "en" && !translations.includes(lang);
  return (
    <Link href={href} hrefLang={localeDef(lang).htmlLang} className={className}>
      {children}
      {pending && (
        <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted">
          <Languages aria-hidden className="size-3.5" /> {localeDef(lang).label} translation in progress — in English for now
        </span>
      )}
    </Link>
  );
}
