"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@im/ui";
import { PRIMARY_NAV } from "./nav-links";

const linkClass =
  "relative rounded-md px-1 py-2 text-[15px] font-medium transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/** Desktop primary navigation with the active section highlighted (as in the compare mockup). */
export function HeaderNav() {
  const pathname = usePathname() ?? "/";
  return <NavItems pathname={pathname} />;
}

/** Static fallback rendered in the prerendered shell (no active state). */
export function HeaderNavFallback() {
  return <NavItems pathname="" />;
}

function NavItems({ pathname }: { pathname: string }) {
  return (
    <ul className="flex items-center gap-8">
      {PRIMARY_NAV.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <li key={l.href}>
            <Link href={l.href} aria-current={active ? "page" : undefined} className={cn(linkClass, active ? "text-brand" : "text-ink-2")}>
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
