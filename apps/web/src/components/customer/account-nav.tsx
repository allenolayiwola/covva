"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, FileText, LayoutGrid, Megaphone, MessageSquare, ScrollText, Shield, User, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@im/ui";

export const ACCOUNT_NAV: { href: string; label: string; icon: LucideIcon; mobile?: string }[] = [
  { href: "/account", label: "Overview", icon: LayoutGrid, mobile: "My cover" },
  { href: "/account/policies", label: "My policies", icon: Shield },
  { href: "/account/family", label: "Family", icon: HeartHandshake },
  { href: "/account/requests", label: "Requests", icon: ScrollText, mobile: "Requests" },
  { href: "/account/messages", label: "Messages", icon: MessageSquare, mobile: "Messages" },
  { href: "/account/documents", label: "Documents", icon: FileText },
  { href: "/account/claims", label: "Claims", icon: Camera, mobile: "Claims" },
  { href: "/account/complaints", label: "Complaints", icon: Megaphone },
  { href: "/account/payments", label: "Payments", icon: Wallet },
  { href: "/account/profile", label: "Profile", icon: User, mobile: "Account" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/account") return pathname === "/account";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Left sidebar from web-account-dashboard.jpg. */
export function AccountSidebar() {
  return <SidebarList pathname={usePathname()} />;
}

/** Static variant used as the Suspense fallback (usePathname needs a boundary with dynamic params). */
export function SidebarList({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Account" className="sticky top-20 space-y-1 py-6 pr-4">
      {ACCOUNT_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium transition-colors",
              active ? "bg-mint-2 text-brand-deep" : "text-ink-2 hover:bg-mist hover:text-ink",
            )}
          >
            <item.icon aria-hidden className={cn("size-[18px]", active ? "text-brand" : "text-muted")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom tab bar on phones (mobile mockups). */
export function AccountTabBar() {
  return <TabBarList pathname={usePathname()} />;
}

export function TabBarList({ pathname }: { pathname: string | null }) {
  const items = ACCOUNT_NAV.filter((i) => i.mobile);
  return (
    <nav
      aria-label="Account sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((item) => {
          const active =
            isActive(pathname, item.href) ||
            (item.href === "/account" && !!pathname?.startsWith("/account/policies")) ||
            (item.href === "/account/profile" && !!pathname && ["/account/documents", "/account/complaints", "/account/payments"].some((p) => pathname.startsWith(p)));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-brand" : "text-muted")}
              >
                <item.icon aria-hidden className="size-5" />
                {item.mobile}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
