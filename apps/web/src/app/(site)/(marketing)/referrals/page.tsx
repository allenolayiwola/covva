import type { Metadata } from "next";
import Link from "next/link";
import { Gift, Link2, Share2, Wallet } from "lucide-react";
import { Notice, Pill } from "@im/ui";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { LeadForm } from "@/components/marketing/lead-form";
import { FaqList } from "@/components/marketing/faq-list";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = {
  title: "Referral programme",
  description: "Refer friends and family to Covva and earn Covva credits when they buy their first policy. Sign up for early access to the referral programme.",
  alternates: { canonical: "/referrals" },
};

const FAQ = [
  { q: "When does the referral programme start?", a: "At public launch. Sign up now and you will be among the first to get a referral link and the launch bonus." },
  { q: "What do I earn?", a: "Covva credits for you and your friend once their first policy has been active for 14 days. Credits are not cash and cannot be withdrawn; they can only reduce Covva fees, or a premium where the insurer funds the offer. Referral rewards switch on only once they are approved by the insurer and the regulator, and amounts are published before launch." },
  { q: "Can brokers and agents use it?", a: "No — this programme is for customers. Licensed brokers and agents have their own partner programme with commission disclosed to customers. See the brokers page." },
  { q: "Does my friend pay more?", a: "No. The premium is the insurer’s price. Your friend gets the same quote with or without a referral, and often a welcome discount." },
];

export default function ReferralsPage() {
  return (
    <>
      <JsonLd data={faqJsonLd(FAQ)} />
      <PageHero
        breadcrumb={[{ label: "Referrals" }]}
        eyebrow={<span className="inline-flex items-center gap-2"><Gift aria-hidden className="size-4" /> Referral programme</span>}
        title={<>Good cover is worth <span className="text-brand">sharing.</span></>}
        lede="Refer friends and family — in Ghana or abroad — and earn Covva credits when they buy their first policy. Launching with the public app."
      >
        <div className="mt-6 flex flex-wrap items-center gap-3"><Link href="/account/referrals" className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-deep">Get my referral link</Link><Pill tone="wait">Rewards start once approved by the NIC and insurers</Pill></div>
      </PageHero>

      <Section labelledBy="how-r-title">
        <SectionHeading id="how-r-title" eyebrow="How it will work" title="Three steps, one link" />
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<Link2 />} title="1. Get your link">Every customer gets a personal referral link and code in the app and on WhatsApp.</FeatureCard>
          <FeatureCard icon={<Share2 />} title="2. Share it">Send it to a friend, your church group or family abroad. They see the same prices — plus a welcome discount.</FeatureCard>
          <FeatureCard icon={<Wallet />} title="3. Earn when they buy">When their first policy is issued and paid, you both get Covva credits once their cover has been active for 14 days.</FeatureCard>
        </div>
        <Notice tone="info" className="mt-8">
          Rewards are funded by Covva’s commission, not by the insurer’s premium, and are disclosed on every referred quote. Referral rewards never change which insurer or product we show you.
        </Notice>
      </Section>

      <Section tone="mist" labelledBy="signup-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="signup-title" eyebrow="Early access" title="Be first in line" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">Leave your details and we will send your referral link the day the programme opens, with a launch bonus for early members.</p>
            <CheckList className="mt-6" items={["No cost to join", "Rewards are Covva credits, not cash", "Works for referrals from the diaspora too"]} />
            <p className="mt-6 text-sm text-muted">A broker or agent? See the <Link href="/brokers" className="font-medium text-brand hover:underline">partner programme</Link> instead.</p>
          </div>
          <LeadForm
            kind="customer"
            tag="referral"
            organization="hidden"
            messageLabel="Who would you refer first?"
            messagePlaceholder="Optional — friends, family abroad, a church group…"
            submitLabel="Sign me up"
            successTitle="You’re on the list."
            successBody="We will send your referral link and launch bonus as soon as the programme opens."
          />
        </div>
      </Section>

      <Section labelledBy="r-faq-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <h2 id="r-faq-title" className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[36px]">Referral questions</h2>
          <FaqList items={FAQ} />
        </div>
      </Section>
    </>
  );
}
