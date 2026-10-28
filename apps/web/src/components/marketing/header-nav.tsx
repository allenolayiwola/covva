"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@im/ui";
import { useT } from "@/lib/i18n/client";
import { PRIMARY_NAV, isGroup, navText, type NavGroup } from "./nav-links";

const linkClass =
  "relative inline-flex h-10 items-center gap-1 rounded-md px-1.5 text-[14.5px] font-medium transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:px-2 lg:text-[15px]";

/** Desktop primary navigation with dropdown groups (Insurance ▾, Partners ▾) and the active section highlighted. */
export function HeaderNav() {
  const pathname = usePathname() ?? "/";
  return <NavItems pathname={pathname} />;
}

/** Static fallback rendered in the prerendered shell (no active state). */
export function HeaderNavFallback() {
  return <NavItems pathname="" />;
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

/** Items marked `from` only appear once the header has room; they stay in the mobile menu and footer. */
const fromClass = { lg: "hidden lg:block", xl: "hidden xl:block" } as const;

function NavItems({ pathname }: { pathname: string }) {
  const t = useT();
  return (
    <ul className="flex items-center gap-1 lg:gap-2">
      {PRIMARY_NAV.map((entry) =>
        isGroup(entry) ? (
          <li key={entry.label} className={cn("relative", entry.from && fromClass[entry.from])}>
            <Dropdown group={entry} pathname={pathname} />
          </li>
        ) : (
          <li key={entry.href} className={entry.from && fromClass[entry.from]}>
            <Link href={entry.href} data-header-fg aria-current={isActive(pathname, entry.href) ? "page" : undefined} className={cn(linkClass, isActive(pathname, entry.href) ? "text-brand" : "text-ink-2")}>
              {navText(t, entry).label}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * Keyboard-accessible disclosure menu (WAI-ARIA "navigation menubar" pattern, simplified):
 * Enter/Space/ArrowDown open; Escape closes and returns focus; Arrow keys move between items;
 * Tab leaves the menu; click outside closes. Also opens on hover for mouse users.
 */
function Dropdown({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  const active = group.items.some((i) => isActive(pathname, i.href));
  const closeTimer = React.useRef<number | undefined>(undefined);
  const t = useT();
  const groupLabel = navText(t, group).label;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Cache Components keeps routes mounted; never leave a menu open across navigations
  // (state adjusted during render, per React guidance, rather than in an effect).
  const [seenPath, setSeenPath] = React.useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  const items = () => Array.from(rootRef.current?.querySelectorAll<HTMLAnchorElement>("[data-menu-item]") ?? []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const idx = list.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        requestAnimationFrame(() => {
          const l = items();
          (l[idx + 1] ?? l[0])?.focus();
        });
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx <= 0) buttonRef.current?.focus();
        else list[idx - 1]?.focus();
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          list[0]?.focus();
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          list[list.length - 1]?.focus();
        }
        break;
    }
  };

  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const cancelClose = () => window.clearTimeout(closeTimer.current);

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") {
          cancelClose();
          setOpen(true);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") scheduleClose();
      }}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-header-fg
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(linkClass, active || open ? "text-brand" : "text-ink-2")}
      >
        {groupLabel}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-1/2 top-full z-50 w-[320px] -translate-x-1/2 pt-2"
      >
        <ul className="rounded-card border border-line bg-white p-2 shadow-float motion-safe:animate-fade-up" aria-label={groupLabel}>
          {group.items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                data-menu-item
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-lg px-3 py-2.5 hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  isActive(pathname, item.href) ? "bg-mint-2" : "",
                )}
              >
                <span className={cn("block text-[15px] font-semibold", isActive(pathname, item.href) ? "text-brand" : "text-ink")}>{navText(t, item).label}</span>
                {item.description && <span className="block text-[12.5px] leading-snug text-muted">{navText(t, item).description}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
