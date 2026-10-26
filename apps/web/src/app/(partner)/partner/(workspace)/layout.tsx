import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@im/ui";
import { HelpCard, SideNav, SideNavSkeleton, TopBarRight } from "@/components/partner/shell";
import { Skeleton } from "@/components/partner/ui";

export const metadata: Metadata = {
  title: { default: "Partner workspace", template: "%s · Partner workspace" },
  robots: { index: false, follow: false },
};

/**
 * Partner workspace shell (broker + insurer). The frame is static; everything that
 * depends on the session/org streams inside <Suspense> so {children} are never held
 * behind a cookie read in the layout (cacheComponents rule).
 */
export default function PartnerLayout({ children }: LayoutProps<"/partner">) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/partner" className="shrink-0" aria-label="Partner workspace home">
            <Logo />
          </Link>
          <div className="flex items-center gap-4 sm:gap-8">
            <span className="hidden text-[15px] text-muted sm:inline">Partner workspace</span>
            <Suspense fallback={<Skeleton className="h-9 w-24" />}>
              <TopBarRight />
            </Suspense>
          </div>
        </div>
      </header>
      <div className="lg:flex">
        <aside className="border-b border-line bg-white px-3 py-3 lg:sticky lg:top-16 lg:flex lg:h-[calc(100dvh-4rem)] lg:w-60 lg:shrink-0 lg:flex-col lg:justify-between lg:border-b-0 lg:border-r lg:bg-mist/40 lg:px-4 lg:py-6">
          <nav aria-label="Workspace">
            <Suspense fallback={<SideNavSkeleton />}>
              <SideNav />
            </Suspense>
          </nav>
          <div className="hidden lg:block">
            <Suspense fallback={<Skeleton className="h-32 w-full" />}>
              <HelpCard />
            </Suspense>
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-9 lg:py-8">
          <div className="mx-auto max-w-[1200px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
