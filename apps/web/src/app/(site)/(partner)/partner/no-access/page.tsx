import type { Metadata } from "next";
import Link from "next/link";
import { Logo, buttonClass } from "@im/ui";
import { ROLE_STATEMENTS } from "@im/core";

export const metadata: Metadata = { title: "No partner access", robots: { index: false, follow: false } };

/**
 * Shown when a signed-in user has no active broker or insurer membership.
 * Deliberately static: it must not require (or check) a partner membership.
 */
export default function NoAccessPage() {
  return (
    <div className="min-h-dvh bg-mist/50">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Home"><Logo /></Link>
          <span className="text-[15px] text-muted">Partner workspace</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        <div className="rounded-card border border-line bg-white p-6 sm:p-8">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">You don’t have partner access yet</h1>
          <p className="mt-2 text-[15px] text-muted">
            The Partner workspace is for staff of licensed brokers and insurers that work with Covva.
            Your account is signed in, but it isn’t linked to a partner organisation.
          </p>
          <h2 className="mt-6 text-lg font-semibold text-ink">How to get access</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[15px] text-ink-2">
            <li>Ask an owner or admin of your organisation to invite you from <span className="font-medium">Team settings → Invite member</span>, using the email address you sign in with.</li>
            <li>Open the invitation link from your email. Invitations expire after 14 days.</li>
            <li>Sign in again. Your organisation’s workspace will open automatically.</li>
          </ol>
          <h2 className="mt-6 text-lg font-semibold text-ink">New partner organisation?</h2>
          <p className="mt-1 text-[15px] text-muted">
            Brokers and insurers are onboarded by our partnerships team after NIC licence verification. {ROLE_STATEMENTS.platform}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/brokers" className={buttonClass("primary", "md")}>Partner with us</Link>
            <Link href="/account" className={buttonClass("secondary", "md")}>Go to my customer account</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
