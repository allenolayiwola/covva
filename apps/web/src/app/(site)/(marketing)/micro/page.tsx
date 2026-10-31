import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { Bike, Bus, Car, Hammer, PartyPopper, Smartphone, Store, Timer } from "lucide-react";
import { AUDIENCE_LABEL, AUDIENCE_TAGS, type AudienceTag, type MicroProductCard } from "@im/core";
import { Pill, buttonClass } from "@im/ui";
import { createPublicClient } from "@/lib/supabase/server";
import { listMicroProducts } from "@/server/micro";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { FaqList } from "@/components/marketing/faq-list";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";
import { CtaBand } from "@/components/marketing/cta-band";

export const metadata: Metadata = {
  title: "Cover by the day, week or month",
  description: "Low-cost daily, weekly and monthly cover for okada, trotro and ride-hailing drivers, market traders, artisans and event organisers. Pay by mobile money in three taps; renew in one.",
  alternates: { canonical: "/micro" },
  openGraph: { title: "Cover by the day, week or month", description: "Pay as you go by mobile money. Renew in one tap.", url: "/micro" },
};

const AUDIENCE_ICON: Record<AudienceTag, typeof Bike> = { okada: Bike, trotro: Bus, ride_hailing: Car, trader: Store, artisan: Hammer, event: PartyPopper };

const FAQ = [
  { q: "Who provides the cover?", a: "A licensed insurer. Covva is a technology platform: we show you the insurer's product and price. Payments are processed by Paystack. Paystack splits each payment, sending the partner's share directly to the partner and Covva's commission directly to Covva." },
  { q: "When does my cover start?", a: "As soon as the insurer issues it. For instant products that is a few moments after you approve the mobile money prompt. Your policy and receipt are in the app and sent by SMS." },
  { q: "What if I forget to renew?", a: "Turn on auto-renew and we send the prompt or charge your saved card before your cover ends. You can also renew in one tap from the app, WhatsApp or USSD." },
  { q: "Can I buy without a smartphone?", a: "Yes. Dial the USSD code shown by your insurer or chat with us on WhatsApp. You pay by mobile money on any phone." },
];

async function microCards(): Promise<MicroProductCard[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog", "micro-products");
  try {
    return await listMicroProducts(createPublicClient());
  } catch {
    return [];
  }
}

export default function MicroPage() {
  return (
    <>
      <JsonLd data={faqJsonLd(FAQ)} />
      <PageHero
        breadcrumb={[{ label: "Micro cover" }]}
        eyebrow={<span className="inline-flex items-center gap-2"><Timer aria-hidden className="size-4" /> Pay as you go</span>}
        title={<>Cover by the day, <span className="text-brand">week or month.</span></>}
        lede="Short, low-cost cover for people who work on the move or on the market — okada, trotro and ride-hailing drivers, traders, artisans and event organisers. Pay by mobile money in three taps. Renew in one."
        actions={
          <>
            <a href="#products" className={buttonClass("primary", "lg")}>See prices</a>
            <Link href="/account/micro" className={buttonClass("secondary", "lg")}>My micro cover</Link>
          </>
        }
      >
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="Who it is for">
          {AUDIENCE_TAGS.map((t) => {
            const Icon = AUDIENCE_ICON[t];
            return (
              <li key={t}>
                <Pill tone="neutral"><Icon aria-hidden className="mr-1 inline size-3.5" />{AUDIENCE_LABEL[t]}</Pill>
              </li>
            );
          })}
        </ul>
      </PageHero>

      <Section id="products" labelledBy="products-title">
        <SectionHeading id="products-title" eyebrow="From licensed insurers" title="Pick your cover" description="Prices are the insurer's. You only pay for the days you need." />
        <Suspense fallback={<p className="mt-8 text-sm text-muted">Loading prices…</p>}>
          <ProductGrid />
        </Suspense>
      </Section>

      <Section tone="mist" labelledBy="how-title">
        <SectionHeading id="how-title" title="Three taps to cover" />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <FeatureCard icon={<Timer aria-hidden className="size-5" />} title="1. Pick a day, week or month">Choose how long you need. The price is shown before you pay.</FeatureCard>
          <FeatureCard icon={<Smartphone aria-hidden className="size-5" />} title="2. Enter your MoMo number">MTN MoMo, Telecel Cash or AirtelTigo Money.</FeatureCard>
          <FeatureCard icon={<Bike aria-hidden className="size-5" />} title="3. Approve and go">Approve the prompt with your PIN. Your policy arrives by SMS and in the app.</FeatureCard>
        </div>
        <CheckList className="mt-8" items={["Payments are processed by Paystack. Paystack splits each payment, sending the partner's share directly to the partner and Covva's commission directly to Covva.", "Renew in one tap, or turn on auto-renew.", "Also on WhatsApp and USSD for any phone."]} />
      </Section>

      <Section labelledBy="faq-title">
        <SectionHeading id="faq-title" title="Questions" />
        <FaqList className="mt-6" items={FAQ} />
      </Section>
      <CtaBand title="Covered for today?" body="Pick your cover, pay by mobile money, and get back to work." primary={{ label: "See prices", href: "#products" }} secondary={{ label: "Talk to us", href: "/contact" }} />
    </>
  );
}

async function ProductGrid() {
  const cards = await microCards();
  if (!cards.length) {
    return <p className="mt-8 rounded-card border border-line bg-white p-6 text-[15px] text-muted">Micro cover is coming soon. Insurers are preparing their daily and weekly products; each one needs the insurer&apos;s and the regulator&apos;s approval before we can sell it.</p>;
  }
  return (
    <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <li key={c.versionId} className="flex flex-col rounded-card border border-line bg-white p-6">
          <p className="text-sm text-muted">{c.insurerName}</p>
          <h3 className="mt-1 text-[17px] font-semibold tracking-tight text-ink">{c.productName}</h3>
          {c.summary && <p className="mt-2 text-[15px] text-muted">{c.summary}</p>}
          <p className="mt-4 text-2xl font-bold text-ink">{c.fromLabel}</p>
          {c.audiences.length > 0 && <p className="mt-2 text-xs text-subtle">For {c.audiences.map((a) => a.label.toLowerCase()).join(", ")}</p>}
          <Link href={`/account/micro/buy?version=${c.versionId}`} className={buttonClass("primary", "md", "mt-5")}>Buy cover</Link>
        </li>
      ))}
    </ul>
  );
}
