import type { Metadata } from "next";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: { absolute: "Covva — coming soon" },
  description: "Covva is coming soon. Join the waitlist for early access.",
  robots: { index: false, follow: false },
};

/**
 * Pre-launch teaser. While the gate is on (SITE_GATE=waitlist, lib/site-gate.ts) every page on a gated host shows this
 * one. Deliberately minimal: no product, pricing or partner detail. Sign-ups use the same LeadForm → `leads` table
 * (tag `waitlist`, same honeypot + minimum fill time) as /waitlist, with only name, email and consent.
 */
export default function ComingSoonPage() {
  return (
    <div className="w-full max-w-[440px] text-center">
      <h1 id="gate-title" className="hero-title whitespace-pre-line font-display text-[40px] leading-[1.04] tracking-[-.035em] text-[#0d4a43] sm:text-[52px]">
        {"Smarter insurance\nis coming."}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-ink-2 sm:text-lg">Join the waitlist for early access.</p>
      <div id="join" className="mt-8 text-left">
        <LeadForm
          compact
          className="border-0 shadow-float"
          kind="customer"
          tag="waitlist"
          consentLabel="You may email me about early access."
          submitLabel="Join the waitlist"
          successTitle="You’re on the list."
          successBody="We’ll be in touch before launch."
        />
      </div>
    </div>
  );
}
