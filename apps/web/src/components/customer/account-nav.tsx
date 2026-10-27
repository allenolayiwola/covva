"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Camera, FileText, Gift, HeartHandshake, LayoutGrid, LockKeyhole, Megaphone, MessageSquare, ScrollText, Shield, User, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@im/ui";
import type { MessageKey } from "@im/core";
import { useT } from "@/lib/i18n/client";

/** `label`/`mobile` are the English text; `k`/`mobileKey` their catalogue keys. */
export const ACCOUNT_NAV: { href: string; label: string; k: MessageKey; icon: LucideIcon; mobile?: string; mobileKey?: MessageKey }[] = [
  { href: "/account", label: "Overview", k: "account.nav.overview", icon: LayoutGrid, mobile: "My cover", mobileKey: "account.nav.myCover" },
  { href: "/account/policies", label: "My policies", k: "account.nav.policies", icon: Shield },
  { href: "/account/family", label: "Family", k: "account.nav.family", icon: HeartHandshake },
  { href: "/account/requests", label: "Requests", k: "account.nav.requests", icon: ScrollText, mobile: "Requests", mobileKey: "account.nav.requests" },
  { href: "/account/messages", label: "Messages", k: "account.nav.messages", icon: MessageSquare, mobile: "Messages", mobileKey: "account.nav.messages" },
  { href: "/account/documents", label: "Documents", k: "account.nav.documents", icon: FileText },
  { href: "/account/claims", label: "Claims", k: "account.nav.claims", icon: Camera, mobile: "Claims", mobileKey: "account.nav.claims" },
  { href: "/account/complaints", label: "Complaints", k: "account.nav.complaints", icon: Megaphone },
  { href: "/account/payments", label: "Payments", k: "account.nav.payments", icon: Wallet },
  { href: "/account/business", label: "Business", k: "account.nav.business", icon: Building2 },
  { href: "/account/referrals", label: "Refer a friend", k: "account.nav.referrals", icon: Gift },
  { href: "/account/privacy", label: "Privacy & data", k: "account.nav.privacy", icon: LockKeyhole },
  { href: "/account/profile", label: "Profile", k: "account.nav.profile", icon: User, mobile: "Account", mobileKey: "account.nav.accountTab" },
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
  const t = useT();
  return (
    <nav aria-label={t("account.nav.label")} className="sticky top-20 space-y-1 py-6 pr-4">
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
            {t(item.k)}
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
  const t = useT();
  return (
    <nav
      aria-label={t("account.nav.sections")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((item) => {
          const active =
            isActive(pathname, item.href) ||
            (item.href === "/account" && !!pathname?.startsWith("/account/policies")) ||
            (item.href === "/account/profile" && !!pathname && ["/account/documents", "/account/complaints", "/account/payments", "/account/privacy"].some((p) => pathname.startsWith(p)));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-brand" : "text-muted")}
              >
                <item.icon aria-hidden className="size-5" />
                {item.mobileKey ? t(item.mobileKey) : item.mobile}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
