import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Bell, User } from "lucide-react";
import { DemoBadge, buttonClass } from "@im/ui";
import { SiteHeader } from "@/components/site-header";
import { getProfile, requireUser } from "@/lib/auth";
import { getFlags } from "@/lib/catalog";
import { AccountSidebar, AccountTabBar, SidebarList, TabBarList } from "@/components/customer/account-nav";
import { AccountMenu } from "@/components/customer/account-menu";
import { NotificationsBell } from "@/components/customer/notifications-bell";
import { Assistant } from "@/components/customer/assistant";
import { PageSkeleton } from "@/components/customer/skeletons";

export const metadata: Metadata = {
  title: { default: "My account", template: "%s · My account" },
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <SiteHeader
        right={
          <Suspense fallback={<HeaderFallback />}>
            <NotificationsBell />
            <AccountMenu />
          </Suspense>
        }
      />
      <div className="mx-auto flex w-full max-w-[1200px] px-0 lg:px-8">
        <aside className="hidden w-60 shrink-0 border-r border-line lg:block">
          <Suspense fallback={<SidebarList pathname={null} />}>
            <AccountSidebar />
          </Suspense>
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 pb-32 pt-6 sm:px-6 lg:pb-16 lg:pl-12 lg:pr-0 lg:pt-8">
          <Suspense fallback={null}>
            <MobileDemoBadge />
          </Suspense>
          <Suspense fallback={<PageSkeleton hero />}>
            <OnboardingGate>{children}</OnboardingGate>
          </Suspense>
        </main>
      </div>
      <Suspense fallback={<TabBarList pathname={null} />}>
        <AccountTabBar />
      </Suspense>
      <Suspense fallback={null}>
        <FlaggedExtras />
      </Suspense>
    </div>
  );
}

function HeaderFallback() {
  return (
    <>
      <span className="grid size-10 place-items-center text-ink-2" aria-hidden>
        <Bell className="size-5" />
      </span>
      <span className={buttonClass("secondary", "sm")} aria-hidden>
        <User className="size-4" />
        <span className="hidden sm:inline">My account</span>
      </span>
    </>
  );
}

/** Customers must finish onboarding (profile + consents) before using the account area. */
async function OnboardingGate({ children }: { children: React.ReactNode }) {
  await requireUser("/account");
  const profile = await getProfile();
  if (!profile?.onboarded_at) redirect("/onboarding?next=/account");
  return <>{children}</>;
}

async function MobileDemoBadge() {
  const flags = await getFlags();
  return flags.demo_mode ? <DemoBadge className="mb-4 lg:hidden" /> : null;
}

/** Demo badge and AI assistant, both driven by admin-controlled feature flags (cached). */
async function FlaggedExtras() {
  const flags = await getFlags();
  return (
    <>
      {flags.demo_mode && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-30 hidden lg:block">
          <DemoBadge className="shadow-card" />
        </div>
      )}
      {flags.ai_assistant && <Assistant />}
    </>
  );
}
