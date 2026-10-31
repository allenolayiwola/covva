"use client";

import * as React from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
import { LOCALES, localeDef, localeNotice, type Locale, type LocaleStatus } from "@im/core";
import { cn } from "@im/ui";
import { chooseLocale, useLocaleStatus, useT } from "@/lib/i18n/client";

/**
 * Best effort: remember the choice on the signed-in profile (`profiles.locale`) so it follows the
 * customer to other devices and the mobile app. Signed-out visitors get a 401, which is ignored.
 */
export function saveProfileLocale(code: Locale) {
  fetch("/api/v1/me/locale", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: code }), credentials: "same-origin" }).catch(() => {});
}

/**
 * Site-wide language switcher in the header (marketing and account areas).
 *
 * Accessible as a disclosure button ("Language: English") opening a list of options. It has no
 * `aria-label` containing "Language" so it never collides with the Learn hub's labelled select.
 * Only English is complete: choosing Twi, Ga or Ewe stores the preference and shows the honest
 * notice below the header — nothing is machine-translated.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useT();
  const { locale } = useLocaleStatus();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();
  const current = localeDef(locale);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    rootRef.current?.querySelector<HTMLButtonElement>("[data-locale-option][aria-current='true'], [data-locale-option]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (code: Locale) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (code === locale) return;
    chooseLocale(code);
    saveProfileLocale(code);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-locale-option]") ?? []);
    const i = items.findIndex((el) => el === document.activeElement);
    const next = e.key === "ArrowDown" ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
    next?.focus();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)} data-testid="locale-switcher">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        data-header-fg
        className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-md px-2 text-[14.5px] font-medium text-ink-2 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Languages aria-hidden className="size-4" />
        <span className="sr-only">{t("locale.current", { name: current.native })}</span>
        <span aria-hidden className="hidden xl:inline">{current.native}</span>
        <span aria-hidden className="uppercase xl:hidden">{current.code === "gaa" ? "GA" : current.code}</span>
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <ul id={listId} onKeyDown={onListKey} className="absolute right-0 top-full z-50 mt-2 w-60 rounded-card border border-line bg-white p-1.5 shadow-float">
          {LOCALES.map((l) => {
            const active = l.code === locale;
            const declared = l.status as LocaleStatus;
            return (
              <li key={l.code}>
                <button
                  type="button"
                  data-locale-option
                  lang={l.htmlLang}
                  aria-current={active ? "true" : undefined}
                  onClick={() => pick(l.code)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[15px] hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    active ? "bg-mint-2 font-semibold text-brand-deep" : "text-ink",
                  )}
                >
                  <span>
                    {l.native}
                    {l.native !== l.label && <span className="ml-1.5 text-[12.5px] font-normal text-muted" lang="en">{l.label}</span>}
                  </span>
                  <span className="flex items-center gap-1.5 text-[12px] font-normal text-muted" lang="en">
                    {declared === "complete" ? null : t(declared === "partial" ? "locale.status.partial" : "locale.status.planned")}
                    {active && <Check aria-hidden className="size-4 text-brand" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Honest notice under the header while a partial/planned locale is chosen. Plain live region
 * (not role=status, so it never competes with page-level status messages).
 */
export function LocaleNotice() {
  const { locale, status } = useLocaleStatus();
  const text = localeNotice(locale, status);
  if (!text) return null;
  return (
    <div className="border-t border-line bg-mint-2/60" data-testid="locale-notice">
      <p aria-live="polite" lang="en" className="mx-auto w-full max-w-[1200px] px-4 py-2 text-[13px] text-ink-2 sm:px-6 lg:px-8">
        {text}
      </p>
    </div>
  );
}
