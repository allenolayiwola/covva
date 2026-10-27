"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, User } from "lucide-react";
import { buttonClass } from "@im/ui";
import { signOut } from "@/app/(auth)/actions";
import { useT } from "@/lib/i18n/client";
import { ACCOUNT_NAV } from "./account-nav";

/** "My account" button + menu in the site header. */
export function AccountMenu() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const ref = React.useRef<HTMLDivElement>(null);
  const t = useT();

  // Close on navigation (adjust state during render rather than in an effect).
  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className={buttonClass("secondary", "sm")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <User aria-hidden className="size-4" />
        <span className="hidden sm:inline">{t("account.menu.myAccount")}</span>
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-card border border-line bg-white py-1.5 shadow-float">
          {ACCOUNT_NAV.map((item) => (
            <Link key={item.href} role="menuitem" href={item.href} className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-2 hover:bg-mist">
              <item.icon aria-hidden className="size-4 text-muted" />
              {t(item.k)}
            </Link>
          ))}
          <div className="my-1.5 border-t border-line" />
          <form action={signOut}>
            <button role="menuitem" type="submit" className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-ink-2 hover:bg-mist">
              <LogOut aria-hidden className="size-4 text-muted" />
              {t("account.menu.signOut")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
