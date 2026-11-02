import type { Metadata } from "next";
import { getImageProps } from "next/image";
import { Container } from "@im/ui";
import { getCategories } from "@/lib/catalog";
import { LeadForm } from "@/components/marketing/lead-form";
import { HeroTrustStrip } from "@/components/marketing/home-hero";
import { CheckList } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: { absolute: "Covva — launching soon. Join the waitlist" },
  description: "Compare, buy and manage insurance in minutes with MoMo or card, from Ghana or abroad. Join the Covva waitlist for early access.",
  robots: { index: false, follow: false },
};

/**
 * Pre-launch waitlist. While the gate is on (SITE_GATE=waitlist, lib/site-gate.ts) every page on a gated host shows
 * this one. Sign-ups use the same LeadForm → `leads` table (and the same honeypot + minimum fill time) as /waitlist.
 */
export default async function ComingSoonPage() {
  const categories = await getCategories();
  const topics = categories.map((c) => ({ value: c.slug, label: c.name }));
  const common = { alt: "Illustration: a couple walking home with a suitcase past their car and house in Ghana.", quality: 85, sizes: "100vw", loading: "eager" as const, fetchPriority: "high" as const };
  const { props: desktop } = getImageProps({ ...common, src: "/images/home-hero/welcome.webp", width: 3840, height: 2160 });
  const { props: mobile } = getImageProps({ ...common, src: "/images/home-hero/welcome-mobile.webp", width: 1200, height: 1364 });

  return (
    <>
      <section aria-labelledby="gate-title" className="relative isolate overflow-hidden">
        <Container className="relative z-10 pb-10 pt-6 md:flex md:min-h-[680px] md:items-center md:py-14">
          <div className="min-w-0 md:max-w-[540px]">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#0d4a43]/15 bg-white/80 px-3 py-1 text-[13px] font-medium text-[#0d4a43]">
              <span aria-hidden className="size-2 rounded-full bg-brand" />
              Launching soon in Ghana
            </p>
            <h1 id="gate-title" className="hero-title mt-5 whitespace-pre-line font-display text-[44px] leading-[1.02] tracking-[-.035em] text-[#0d4a43] md:text-[56px]">
              {"Smarter insurance\nis almost here."}
            </h1>
            <p className="mt-5 max-w-[480px] text-base leading-[1.65] text-ink-2 md:text-lg">
              Covva lets you compare cover from licensed insurers side by side, pay by MoMo or card, and keep every policy on
              your phone — from Ghana or abroad. Join the waitlist and we will invite you before public launch.
            </p>
            <CheckList
              className="mt-5"
              items={["Early access to the app on iOS and Android", "A launch discount on your first policy", "Abroad? Pay in GBP, USD, EUR or CAD from day one"]}
            />

            <div id="join" className="mt-8 md:w-[520px]">
              <h2 className="mb-3 text-h4 text-[#0d4a43]">Join the waitlist</h2>
              <LeadForm
                className="border-0 shadow-float"
                kind="customer"
                tag="waitlist"
                organization="hidden"
                topicLabel="What would you insure first?"
                topics={topics}
                messageLabel="Anything else?"
                messagePlaceholder="Optional — where you are based, what matters most to you."
                submitLabel="Join the waitlist"
                successTitle="You’re on the waitlist."
                successBody="We will email or message you with your early-access invitation before public launch."
              />
            </div>
          </div>
        </Container>

        {/* Phones: the scene as a band under the form. Tablet and up: the right 60% of the section, blended into the cream. */}
        <figure className="relative h-[320px] sm:h-[420px] md:absolute md:inset-y-0 md:left-[40%] md:right-0 md:h-auto">
          <picture>
            <source media="(max-width: 767px)" srcSet={mobile.srcSet} sizes={mobile.sizes} />
            {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from getImageProps */}
            <img {...desktop} className="absolute inset-0 block size-full object-cover object-[50%_75%] md:object-right" />
          </picture>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#F6E9D5] to-transparent md:inset-y-0 md:left-0 md:right-auto md:h-auto md:w-[35%] md:bg-gradient-to-r md:from-[#F6E9D5] md:to-transparent" />
          <figcaption className="absolute bottom-3 right-3 rounded-full bg-white/85 px-2.5 py-0.5 text-[12px] text-muted">Image: AI-generated</figcaption>
        </figure>
      </section>

      <HeroTrustStrip />

      <section aria-labelledby="partners-title" className="bg-white py-14 md:py-20">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <p className="text-sm font-medium text-brand">Insurers & brokers</p>
            <h2 id="partners-title" className="mt-2 text-h2 text-ink">Become a launch partner</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">
              A limited number of licensed insurers and brokers join the pilot with founding-partner terms: priority placement
              at launch, co-marketing, and a say in the roadmap.
            </p>
          </div>
          <LeadForm
            kindOptions={["insurer", "broker", "enterprise"]}
            defaultKind="insurer"
            tag="launch_partner"
            organization="required"
            messageLabel="About your organisation"
            messagePlaceholder="NIC licence number, classes of business, and what you would like from a launch partnership."
            submitLabel="Apply as a launch partner"
            successTitle="Thank you — application received."
            successBody="Our partnerships team will be in touch within two working days to arrange an introductory conversation."
          />
        </Container>
      </section>
    </>
  );
}
