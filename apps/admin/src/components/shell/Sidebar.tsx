"use client";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, X } from "lucide-react";
import { cn } from "@im/ui";
import { NAV, activeGroup, activeItem, type NavGroup } from "./nav";

/* ----------------------------------------------------------------------------
 * Remembered open/closed state per group (localStorage; every access guarded,
 * the sidebar works the same when storage is blocked or empty).
 * ------------------------------------------------------------------------- */
const STORAGE_KEY = "covva-admin:nav-groups";
const CHANGE_EVENT = "covva-admin:nav-groups";
/** In-memory copy, used when localStorage is blocked or full (the toggles then last for this tab). */
let memoryRaw: string | null = null;
let storageOk = true;

function readRaw(): string | null {
  if (!storageOk) return memoryRaw;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    storageOk = false;
    return memoryRaw;
  }
}

function parse(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, boolean] => typeof e[1] === "boolean"));
  } catch {
    return {};
  }
}

function writeGroup(id: string, open: boolean) {
  const next = JSON.stringify({ ...parse(readRaw()), [id]: open });
  memoryRaw = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    storageOk = false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function useRememberedGroups(): Record<string, boolean> {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parse(raw), [raw]);
}

/* ----------------------------------------------------------------------------
 * Sidebar navigation (dark brand rail)
 * ------------------------------------------------------------------------- */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeItem(pathname);
  const currentGroup = activeGroup(pathname);
  const remembered = useRememberedGroups();
  // Collapsing the group that holds the current page applies to this page only; moving to another page re-opens
  // the group that holds it.
  const [collapsedOn, setCollapsedOn] = useState<string | null>(null);

  function isOpen(group: NavGroup): boolean {
    if (group.id === currentGroup?.id) return collapsedOn !== pathname;
    return remembered[group.id] ?? false;
  }

  function toggle(group: NavGroup) {
    const next = !isOpen(group);
    if (group.id === currentGroup?.id) setCollapsedOn(next ? null : pathname);
    writeGroup(group.id, next);
  }

  return (
    <nav aria-label="Admin" className="flex flex-col gap-1 px-3 py-3">
      {NAV.map((group) =>
        group.label ? (
          <NavSection key={group.id} group={group} open={isOpen(group)} onToggle={() => toggle(group)} currentHref={current?.href} onNavigate={onNavigate} />
        ) : (
          <ul key={group.id} className="mb-1 flex flex-col gap-px">
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} active={current?.href === item.href} onNavigate={onNavigate} />
            ))}
          </ul>
        ),
      )}
    </nav>
  );
}

function NavSection({
  group,
  open,
  onToggle,
  currentHref,
  onNavigate,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  currentHref?: string;
  onNavigate?: () => void;
}) {
  const listId = useId();
  const holdsCurrent = group.items.some((i) => i.href === currentHref);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className={cn(
          "group/sec flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[13px] font-semibold tracking-[0.01em] transition-colors",
          "text-rail-muted hover:bg-rail-hover hover:text-white",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight",
        )}
      >
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        <span className="flex-1">{group.label}</span>
        {holdsCurrent && !open && <span aria-hidden className="size-1.5 rounded-full bg-highlight" />}
        <span className="sr-only">{holdsCurrent && !open ? " (contains the current page)" : ""}</span>
      </button>
      <ul id={listId} hidden={!open} className="mb-1.5 mt-px flex flex-col gap-px">
        {group.items.map((item) => (
          <NavLink key={item.href} item={item} active={item.href === currentHref} onNavigate={onNavigate} indent />
        ))}
      </ul>
    </div>
  );
}

function NavLink({ item, active, onNavigate, indent }: { item: (typeof NAV)[number]["items"][number]; active: boolean; onNavigate?: () => void; indent?: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-2.5 rounded-sm py-1.5 pr-2.5 text-sm transition-colors",
          indent ? "pl-[30px]" : "pl-2.5",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-highlight",
          active ? "bg-rail-active font-semibold text-white" : "text-rail-text hover:bg-rail-hover hover:text-white",
        )}
      >
        {active && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-[1px] bg-highlight" />}
        <Icon className={cn("size-4 shrink-0", active ? "text-highlight" : "text-rail-muted")} aria-hidden />
        <span className="min-w-0 truncate">{item.label}</span>
      </Link>
    </li>
  );
}

/* ----------------------------------------------------------------------------
 * Top-bar breadcrumb: "Group / Page", derived from nav.ts
 * ------------------------------------------------------------------------- */
export function ShellBreadcrumb() {
  const pathname = usePathname();
  const item = activeItem(pathname);
  const group = activeGroup(pathname);
  if (!item) return null;
  const deeper = pathname !== item.href;
  return (
    <nav aria-label="Location" className="hidden min-w-0 items-center gap-1.5 truncate text-sm md:flex">
      {group?.label && <span className="text-muted">{group.label}</span>}
      {group?.label && <span aria-hidden className="text-subtle">/</span>}
      {deeper ? (
        <Link href={item.href} className="truncate font-medium text-ink hover:text-brand">
          {item.label}
        </Link>
      ) : (
        <span aria-current="page" className="truncate font-medium text-ink">
          {item.label}
        </span>
      )}
    </nav>
  );
}

/* ----------------------------------------------------------------------------
 * Mobile navigation: native <details> so it opens without hydration-heavy state
 * ------------------------------------------------------------------------- */
export function MobileNav({ children }: { children?: React.ReactNode }) {
  return (
    <details className="group/mnav relative lg:hidden">
      <summary
        className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-sm border border-line px-2.5 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden"
      >
        <Menu className="size-4 group-open/mnav:hidden" aria-hidden />
        <X className="hidden size-4 group-open/mnav:block" aria-hidden />
        Menu
      </summary>
      <div className="fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col overflow-y-auto bg-rail">
        <SidebarNav
          onNavigate={() => {
            document.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
          }}
        />
        {children}
      </div>
    </details>
  );
}
