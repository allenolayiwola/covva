import Link from "next/link";
import { Logo, buttonClass } from "@im/ui";

/**
 * Shared top bar from the mockups (logo · Explore cover · How it works · Support · bell · My account).
 * Used by marketing and customer areas. `right` lets signed-in areas swap the account controls.
 * Owner: Marketing stream may restyle internals but must keep this API.
 */
export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0" aria-label="Insurance Marketplace home">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-8 text-[15px] text-ink-2 md:flex">
          <Link href="/explore" className="hover:text-brand">Explore cover</Link>
          <Link href="/how-it-works" className="hover:text-brand">How it works</Link>
          <Link href="/support" className="hover:text-brand">Support</Link>
        </nav>
        <div className="flex items-center gap-3">
          {right ?? (
            <Link href="/account" className={buttonClass("secondary", "sm")}>My account</Link>
          )}
        </div>
      </div>
    </header>
  );
}
