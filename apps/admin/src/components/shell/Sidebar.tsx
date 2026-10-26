"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@im/ui";
import { NAV, isActive } from "./nav";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((group, gi) => (
        <div key={gi}>
          {group.label && (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{group.label}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-sm transition-colors",
                      active ? "bg-mint font-semibold text-brand-deep" : "text-muted hover:bg-mist hover:text-ink",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Mobile drawer toggle using a native <details> so it works without hydration-heavy state. */
export function MobileNav() {
  return (
    <details className="group relative lg:hidden">
      <summary className="flex h-9 cursor-pointer list-none items-center rounded-[10px] border border-line px-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        Menu
      </summary>
      <div className="fixed inset-x-0 bottom-0 top-14 z-40 overflow-y-auto border-t border-line bg-white">
        <SidebarNav
          onNavigate={() => {
            document.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
          }}
        />
      </div>
    </details>
  );
}
