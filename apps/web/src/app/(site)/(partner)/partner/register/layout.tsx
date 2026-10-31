import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ROLE_STATEMENTS } from "@im/core";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Partner registration",
  robots: { index: false, follow: false },
};

/**
 * Registration shell for insurers and brokers (outside the partner workspace: the applicant
 * is not a member of any partner organisation yet). Static frame; the steps stream inside.
 */
export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-mist/60">
      <SiteHeader
        right={
          <Link href="/support" className="text-sm font-medium text-brand hover:underline">
            Need help?
          </Link>
        }
      />
      <main id="main" className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {children}
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-subtle">
        <p className="mx-auto flex max-w-xl items-start justify-center gap-1.5">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{ROLE_STATEMENTS.platform}</span>
        </p>
      </footer>
    </div>
  );
}
