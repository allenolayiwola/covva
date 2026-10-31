"use client";

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronDown, Menu, UserRound, X } from "lucide-react";
import { buttonClass, cn } from "@im/ui";
import { T, useT } from "@/lib/i18n/client";
import { PRIMARY_NAV, SECONDARY_NAV, isGroup, navText } from "./nav-links";

/** Small, dependency-free mobile menu (< md). Groups expand inline; closes on Escape and on navigation. */
export function MobileMenu({ showAccount = true }: { showAccount?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>("Insurance");
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const t = useT();

  const close = React.useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a,button") ?? []).filter((el) => el.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const wide = window.matchMedia("(min-width: 768px)");
    const onResize = () => { if (wide.matches) close(); };
    wide.addEventListener("change", onResize);
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onResize);
    };
  }, [open, close]);

  // Cache Components keeps hidden routes mounted; make sure the menu never stays open across them.
  React.useEffect(() => () => setOpen(false), []);

  const itemClass = "flex items-center justify-between py-3.5 text-[17px] font-semibold text-ink rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? t("header.closeMenu") : t("header.openMenu")}
        onClick={() => setOpen((o) => !o)}
        data-header-fg
        className="grid size-11 place-items-center rounded-[10px] text-ink transition-colors hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>

      {open && createPortal(<div
        role="dialog"
        aria-modal="true"
        aria-label={t("header.mobileNav")}
        id={id}
        ref={panelRef}
        hidden={!open}
        className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-white"
      >
        <div className="sticky top-0 z-10 flex justify-end border-b border-line bg-white px-4 py-3">
          <button type="button" onClick={() => close()} aria-label={t("header.closeMenu")} className="grid size-11 place-items-center rounded-lg text-ink"><X aria-hidden className="size-5" /></button>
        </div>
        <nav aria-label={t("header.mobileNav")} className="px-4 pb-10 pt-2">
          <ul className="divide-y divide-line">
            {PRIMARY_NAV.map((entry) =>
              isGroup(entry) ? (
                <li key={entry.label}>
                  <button
                    type="button"
                    aria-expanded={expanded === entry.label}
                    aria-controls={`${id}-${entry.label}`}
                    onClick={() => setExpanded((e) => (e === entry.label ? null : entry.label))}
                    className={cn(itemClass, "w-full text-left")}
                  >
                    {navText(t, entry).label}
                    <ChevronDown aria-hidden className={cn("size-4 text-subtle transition-transform motion-reduce:transition-none", expanded === entry.label && "rotate-180")} />
                  </button>
                  <ul id={`${id}-${entry.label}`} hidden={expanded !== entry.label} className="mb-3 grid grid-cols-1 gap-0.5 rounded-xl bg-mist p-2">
                    {entry.items.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href} onClick={() => close(false)} className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-ink-2 hover:bg-white hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                          {navText(t, item).label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={entry.href}>
                  <Link href={entry.href} onClick={() => close(false)} className={itemClass}>
                    {navText(t, entry).label}
                    <ArrowRight aria-hidden className="size-4 text-subtle" />
                  </Link>
                </li>
              ),
            )}
          </ul>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-subtle"><T k="header.more" /></p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {SECONDARY_NAV.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => close(false)} className="block rounded-lg py-2 text-[15px] text-ink-2 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  {navText(t, l).label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-8 grid gap-3">
            <Link href="/get-started" onClick={() => close(false)} className={buttonClass("primary", "lg", "w-full")}>
              <T k="header.getQuote" />
            </Link>
            {showAccount && (
              <Link href="/account" onClick={() => close(false)} className={buttonClass("secondary", "lg", "w-full")}>
                <UserRound aria-hidden className="size-4" />
                <T k="header.myAccount" />
              </Link>
            )}
          </div>
        </nav>
      </div>, document.body)}
    </div>
  );
}
