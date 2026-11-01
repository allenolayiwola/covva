import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Notice } from "@im/ui";
import { PageHero } from "@/components/marketing/page-hero";
import { Section, SectionHeading } from "@/components/marketing/section";
import { textLinkClass } from "@/components/marketing/ui-classes";
import { JoinNetworkForm } from "./join-form";

export const metadata: Metadata = {
  title: "Join the claims partner network",
  description: "Garages, towing services, hospitals, clinics, pharmacies and loss assessors can apply to join the Covva claims partner network.",
  alternates: { canonical: "/claims/network/join" },
};

export default function JoinNetworkPage() {
  return (
    <>
      <PageHero
        eyebrow="Partner network"
        title="Join the claims partner network"
        lede="Garages, towing services, hospitals, clinics, pharmacies and loss assessors can apply. Approved partners are listed in our public directory and can be booked for jobs on claims; where an insurer agrees direct billing, it settles your invoices."
      />
      <Section labelledBy="join-title">
        <SectionHeading id="join-title" eyebrow="Apply" title="Tell us about your business" description="It takes about three minutes. We check every application before a partner is listed." />
        <div className="mx-auto max-w-2xl">
          <JoinNetworkForm />
          <Notice tone="neutral" className="mt-6">
            Covva is a technology platform. Listing in the network does not guarantee work, and only the insurer approves and pays a claim. Customers can rate partners after a completed job; ratings show once a partner has three reviews.
          </Notice>
          <p className="mt-6 text-[14.5px]">
            <Link href="/claims/network" className={textLinkClass}>See the partner directory <ArrowRight aria-hidden className="size-4" /></Link>
          </p>
        </div>
      </Section>
    </>
  );
}
