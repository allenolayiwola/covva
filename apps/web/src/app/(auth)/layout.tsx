import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ROLE_STATEMENTS } from "@im/core";
import { SiteHeader } from "@/components/site-header";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-mist/60">
      <SiteHeader
        right={
          <Link href="/support" className="text-sm font-medium text-brand hover:underline">
            Need help?
          </Link>
        }
      />
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-[480px]">{children}</div>
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
