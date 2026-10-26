import { Suspense } from "react";
import Link from "next/link";
import { ShieldCheck, UserRound } from "lucide-react";
import { buttonClass } from "@im/ui";
import { getBrand } from "@/components/marketing/brand";
import { HeaderNav, HeaderNavFallback } from "@/components/marketing/header-nav";
import { MobileMenu } from "@/components/marketing/mobile-menu";

/**
 * Shared top bar from the mockups (logo · Explore cover · How it works · Support · My account).
 * Used by marketing and customer areas. `right` lets signed-in areas swap the account controls.
 * Owner: Marketing stream may restyle internals but must keep this API.
 */
export async function SiteHeader({ right }: { right?: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          aria-label={`${brand.name} home`}
        >
          <span aria-hidden className="grid size-8 place-items-center rounded-[9px] bg-brand text-white shadow-card">
            <ShieldCheck className="size-[18px]" strokeWidth={2.25} />
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-ink">{brand.name}</span>
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <Suspense fallback={<HeaderNavFallback />}>
            <HeaderNav />
          </Suspense>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {right ?? (
            <>
              <Link href="/brokers" className="hidden rounded-md px-2 py-2 text-[15px] font-medium text-muted hover:text-brand lg:inline-block">
                For partners
              </Link>
              <span className="hidden sm:block">
                <Link href="/account" className={buttonClass("secondary", "sm")}>
                  <UserRound aria-hidden className="size-4" />
                  My account
                </Link>
              </span>
            </>
          )}
          <MobileMenu showAccount={!right} />
        </div>
      </div>
    </header>
  );
}
