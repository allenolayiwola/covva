import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail, Phone, UserRoundCheck } from "lucide-react";
import { Container, Eyebrow } from "@im/ui";
import { getBrand } from "@/components/marketing/brand";
import { FAQ_GROUPS } from "@/components/marketing/content";
import { FaqSearch } from "@/components/marketing/faq-search";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";
import { IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "Help centre",
  description:
    "Answers about getting quotes, paying, policies and documents, renewals, claims, complaints and your account — and how to reach us.",
  alternates: { canonical: "/support" },
};

export default async function SupportPage() {
  const brand = await getBrand();
  const all = FAQ_GROUPS.flatMap((g) => g.items);

  return (
    <>
      <JsonLd data={faqJsonLd(all)} />
      <section aria-labelledby="support-title" className="relative overflow-hidden border-b border-line bg-gradient-to-b from-mist to-white">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[480px] rounded-full bg-mint-2 opacity-70 blur-3xl" />
        <Container className="relative py-14 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <Eyebrow className="text-center">Help centre</Eyebrow>
            <h1 id="support-title" className="mt-4 text-balance text-center text-[36px] font-bold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[50px]">
              How can we help?
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-center text-[17px] leading-relaxed text-muted">
              Search our answers, or get in touch. For an existing request or policy, message your broker from your account — it’s the fastest route.
            </p>
            <div className="mt-10">
              <FaqSearch groups={FAQ_GROUPS} />
            </div>
          </div>
        </Container>
      </section>

      <Section tone="mist" labelledBy="contact-options-title">
        <SectionHeading id="contact-options-title" eyebrow="Contact options" title="Still need help?" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/account" className="group rounded-card border border-line bg-white p-6 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <IconTile><UserRoundCheck /></IconTile>
            <h3 className="mt-5 font-semibold text-ink">Message your broker</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">For quotes, policies, renewals and claims. Threaded with your documents.</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">Go to my account <ArrowRight aria-hidden className="size-4" /></span>
          </Link>
          <a href={`mailto:${brand.supportEmail}`} className="rounded-card border border-line bg-white p-6 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <IconTile><Mail /></IconTile>
            <h3 className="mt-5 font-semibold text-ink">Email us</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">We reply within two working days.</p>
            <span className="mt-4 block break-all text-sm font-semibold text-brand">{brand.supportEmail}</span>
          </a>
          <div className="rounded-card border border-line bg-white p-6">
            <IconTile><Phone /></IconTile>
            <h3 className="mt-5 font-semibold text-ink">Call us</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">Mon–Fri 08:00–17:00, Sat 09:00–13:00 (GMT).</p>
            {brand.supportPhone ? (
              <a href={`tel:${brand.supportPhone.replace(/\s+/g, "")}`} className="mt-4 block text-sm font-semibold text-brand">{brand.supportPhone}</a>
            ) : (
              <p className="mt-4 text-sm font-medium text-subtle">Phone line to be announced</p>
            )}
          </div>
        </div>
      </Section>

      <Section id="contact" labelledBy="support-form-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="support-form-title" eyebrow="Send a message" title="Write to us" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Questions about the platform, feedback, or a complaint about our service. If it’s about a specific request or policy, include its reference (for example DEMO-028).
            </p>
            <p className="mt-6 text-sm text-muted">
              Making a complaint? See our <Link href="/legal/complaints" className="font-medium text-brand hover:underline">complaints procedure</Link>.
            </p>
          </div>
          <LeadForm kindOptions={["customer", "other", "press"]} defaultKind="customer" organization="hidden" />
        </div>
      </Section>
    </>
  );
}
