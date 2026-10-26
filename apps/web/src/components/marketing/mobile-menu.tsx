"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Menu, UserRound, X } from "lucide-react";
import { buttonClass } from "@im/ui";
import { PRIMARY_NAV, SECONDARY_NAV } from "./nav-links";

/** Small, dependency-free mobile menu (< md). Closes on Escape, on navigation and on outside scroll lock release. */
export function MobileMenu({ showAccount = true }: { showAccount?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  const close = React.useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Cache Components keeps hidden routes mounted; make sure the menu never stays open across them.
  React.useEffect(() => () => setOpen(false), []);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-[10px] text-ink transition-colors hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>

      <div
        id={id}
        ref={panelRef}
        hidden={!open}
        className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto border-t border-line bg-white motion-safe:animate-fade-up"
      >
        <nav aria-label="Mobile" className="px-4 pb-10 pt-4">
          <ul className="divide-y divide-line">
            {PRIMARY_NAV.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => close(false)} className="flex items-center justify-between py-4 text-lg font-semibold text-ink">
                  {l.label}
                  <ArrowRight aria-hidden className="size-4 text-subtle" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-subtle">More</p>
          <ul className="mt-2 grid grid-cols-1 gap-1">
            {SECONDARY_NAV.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => close(false)} className="block rounded-lg py-2.5 text-[16px] text-ink-2 hover:text-brand">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-8 grid gap-3">
            <Link href="/get-started" onClick={() => close(false)} className={buttonClass("primary", "lg", "w-full")}>
              What do I need?
            </Link>
            {showAccount && (
              <Link href="/account" onClick={() => close(false)} className={buttonClass("secondary", "lg", "w-full")}>
                <UserRound aria-hidden className="size-4" />
                My account
              </Link>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
