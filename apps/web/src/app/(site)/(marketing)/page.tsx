import { PAYMENTS_DISCLOSURE } from "@/components/marketing/payments-disclosure";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Building2,
  CreditCard,
  FileText,
  Globe2,
  Layers,
  QrCode,
  Smartphone,
  UserRoundCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { DemoBadge, Eyebrow, Pill, buttonClass } from "@im/ui";
import { ROLE_STATEMENTS } from "@im/core";
import { getCategories, getPartnerDirectory } from "@/lib/catalog";
import { displayOrgName, getBrand, isDemoMode, isDemoOrg } from "@/components/marketing/brand";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { HeroTrustStrip, HomeHero } from "@/components/marketing/home-hero";
import { TrustBar } from "@/components/marketing/trust-bar";
import { CompareIllustration, PayIllustration, PolicyIllustration } from "@/components/marketing/how-it-works-illustrations";
import { CategoryIcon } from "@/components/marketing/category-icon";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { FaqList } from "@/components/marketing/faq-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { AppDownload } from "@/components/marketing/app-download";
import { StatsCounter } from "@/components/marketing/stats-counter";
import { Testimonials } from "@/components/marketing/testimonials";
import { PartnerCtaStrip } from "@/components/marketing/partner-cta-strip";
import { RenewalReminderForm } from "@/components/marketing/renewal-reminder-form";
import { Reveal } from "@/components/marketing/reveal";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";
import { KEY_BENEFITS, STATS } from "@/components/marketing/content";
import { getFaqsFor, getPartners, getTestimonials } from "@/server/cms";
import { PRODUCT_LINES } from "@/components/marketing/products-content";
import { getFromPrices, monthlyFrom } from "@/components/marketing/pricing";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: { absolute: "Covva — Protect what matters. Wherever you are." },
  description:
    "Compare insurance quotes from licensed brokers in Ghana, at home or from abroad. Get real quotes for motor, home, health, travel, life and business insurance from licensed insurers in Ghana through brokers you choose. Pay by MoMo or card; the insurer issues your policy to a digital wallet with QR verification.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Covva — Protect what matters. Wherever you are.",
    description: "Insurance for Ghana and the diaspora: compare quotes from licensed insurers through your broker, pay by MoMo or card, get your policy in your wallet.",
    url: "/",
    images: ["/opengraph-image"],
  },
};

const STEPS = [
  { title: "Compare", body: "Tell us what you want to insure. See quotes from participating licensed insurers side by side — cover, excess and price.", Illustration: CompareIllustration },
  { title: "Pay by MoMo or card", body: "MTN MoMo, Telecel Cash, AirtelTigo Money, Visa or Mastercard — in cedis, or in GBP, USD, EUR and CAD from abroad.", Illustration: PayIllustration },
  { title: "Get your policy instantly", body: "The insurer issues your certificate and it lands in your wallet with a QR code anyone can verify.", Illustration: PolicyIllustration },
];

const BENEFIT_ICONS = { instant: Zap, instalments: CreditCard, reminders: BellRing, claims: FileText, wallet: QrCode } as const;

export default async function HomePage() {
  // CMS-managed blocks (FAQs, testimonials, partner logos) fall back to the typed content / partner directory.
  const [categories, directory, demo, brand, prices, faqs, testimonials, partners] = await Promise.all([
    getCategories(),
    getPartnerDirectory(),
    isDemoMode(),
    getBrand(),
    getFromPrices(),
    getFaqsFor("home"),
    getTestimonials(),
    getPartners(),
  ]);

  const preferred = ["coastline-general", "volta-mutual", "ashanti-shield"];
  const heroInsurers = preferred
    .map((slug) => directory.insurers.find((i) => i.slug === slug))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .concat(directory.insurers.filter((i) => !preferred.includes(i.slug)))
    .slice(0, 3)
    .map((i) => ({ name: i.name, color: i.brand_color }));
  const reminderCategories = categories.map((c) => ({ slug: c.slug, name: c.name }));
  const anyIllustrative = testimonials.some((t) => t.illustrative);
  const anyDemoPartner = directory.insurers.some((o) => isDemoOrg(o.settings));

  return (
    <>
      <JsonLd data={faqJsonLd(faqs)} />

      <HomeHero />
      <HeroTrustStrip />

      <TrustBar insurers={directory.insurers} demo={demo} partners={partners} />

      {/* How it works ------------------------------------------------------------ */}
      <Section labelledBy="how-title">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="Three steps. No paperwork."
          description="A licensed broker is accountable for your request throughout, and nothing is active until the insurer confirms."
          action={<Link href="/how-it-works" className={textLinkClass}>The full journey <ArrowRight aria-hidden className="size-4" /></Link>}
        />
        <ol className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} as="li" delay={i * 90} className="rounded-card border border-line bg-white p-5 sm:p-6">
              <s.Illustration className="h-auto w-full rounded-[16px]" />
              <div className="mt-5 flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-brand text-sm font-semibold tabular-nums text-white">{i + 1}</span>
                <h3 className="text-[19px] font-semibold tracking-tight text-ink">{s.title}</h3>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* Product tiles ----------------------------------------------------------- */}
      <Section tone="mist" labelledBy="cover-title" className="pt-4! sm:pt-6!">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="cover-title" className="text-h3 text-ink">Cover for what matters to you</h2>
          <p className="text-sm text-muted">“From” prices are indicative monthly figures from approved products; your quote may differ.</p>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {PRODUCT_LINES.map((p) => {
            const from = monthlyFrom(prices, p.categorySlugs, p.fromMonthlyGhs);
            const cat = categories.find((c) => p.categorySlugs.includes(c.slug));
            return (
              <li key={p.slug}>
                <Link
                  href={`/insurance/${p.slug}`}
                  className="group flex h-full min-h-[136px] flex-col justify-between rounded-card border border-line bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <CategoryIcon icon={p.icon} className="size-6 text-brand" />
                    {cat?.availability === "planned" ? <Pill tone="wait">Planned</Pill> : <Pill tone="ok">Available</Pill>}
                  </div>
                  <div className="mt-6">
                    <span className="block text-[17px] font-semibold leading-snug tracking-tight text-ink">{p.short}</span>
                    <span className="mt-1 block text-[13px] text-muted">
                      from <span className="font-semibold text-ink-2">GH₵ {from.monthly}</span>/month
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href="/explore"
              className="flex h-full min-h-[136px] flex-col justify-between rounded-card border border-dashed border-brand/40 bg-white p-5 text-brand-deep transition-colors hover:bg-mint-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <Layers aria-hidden className="size-6" strokeWidth={1.75} />
              <span className="mt-6 flex items-center justify-between text-[17px] font-semibold">
                Explore all cover
                <ArrowRight aria-hidden className="size-4" />
              </span>
            </Link>
          </li>
        </ul>
      </Section>

      {/* Key benefits ------------------------------------------------------------ */}
      <Section labelledBy="benefits-title">
        <SectionHeading id="benefits-title" eyebrow="Why Covva" title="Built for how people here actually live, work and pay." />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {KEY_BENEFITS.map((b, i) => {
            const Icon = BENEFIT_ICONS[b.id];
            return (
              <Reveal key={b.id} as="li" delay={i * 60} className="rounded-card border border-line bg-white p-6">
                <IconTile><Icon /></IconTile>
                <h3 className="mt-5 font-semibold tracking-tight text-ink">{b.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{b.body}</p>
              </Reveal>
            );
          })}
        </ul>
      </Section>

      {/* Diaspora ------------------------------------------------------------------ */}
      <Section tone="brand" labelledBy="diaspora-title" className="overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/60" />
        <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand"><Globe2 aria-hidden className="size-4" /> For the diaspora</p>
            <h2 id="diaspora-title" className="text-balance text-h2 text-ink">Protect your family back home.</h2>
            <p className="mt-4 max-w-xl text-lead text-muted">
              Pay in GBP, USD, EUR or CAD for a parent’s health plan, the family car or the house you are building in Kumasi. You both get the documents, the reminders and every claim update.
            </p>
            <CheckList className="mt-7" items={["Add parents and relatives as beneficiaries", "Family dashboard with every policy you pay for", "Gift a policy, or bundle a “Parents’ Care Pack”", "Group plans for churches and associations"]} />
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/diaspora" className={buttonClass("primary", "lg")}>Insure family in Ghana <ArrowRight aria-hidden className="size-4" /></Link>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              { cur: "£", title: "Mum’s health plan", body: "Private outpatient + inpatient in Kumasi, paid monthly from London." },
              { cur: "$", title: "Dad’s car, comprehensive", body: "Paid annually from Houston; certificate in both wallets." },
              { cur: "€", title: "Home under construction", body: "Buildings cover for the Oyarifa house, paid from Hamburg." },
              { cur: "C$", title: "Funeral plan for both parents", body: "Monthly from Toronto; benefit paid within days of a claim." },
            ].map((c) => (
              <li key={c.title} className="rounded-card border border-line bg-white p-5">
                <span aria-hidden className="grid size-9 place-items-center rounded-lg bg-mint text-sm font-semibold text-brand-deep">{c.cur}</span>
                <p className="mt-4 font-semibold text-ink">{c.title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Price comparison teaser ------------------------------------------------- */}
      <Section labelledBy="compare-title">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <Eyebrow className="mb-3">Compare the cover, not just the price</Eyebrow>
            <h2 id="compare-title" className="text-balance text-h2 text-ink">
              The same car. Three insurers. Three different prices.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">
              Premiums for the same risk can differ by 15–25% between insurers, and the cheapest is not always the one with the lowest excess. Every comparison lines up premium, excess, limits and exclusions — and says how many insurers were compared.
            </p>
            <CheckList
              className="mt-8"
              items={[
                "We tell you how many insurers and products were compared — never “the whole market”.",
                "Every quote is time-stamped and checked again before you pay.",
                "Save a quote and come back later; share it by WhatsApp or email.",
              ]}
            />
            <Link href="/how-it-works" className={`${textLinkClass} mt-8`}>How comparisons work <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
          <HeroVisual insurers={heroInsurers} demo={demo || anyDemoPartner} />
        </div>
      </Section>

      <AppDownload insurers={heroInsurers.map((i) => i.name)} />

      {/* Stats + testimonials ------------------------------------------------------ */}
      <Section labelledBy="stats-title">
        <SectionHeading
          id="stats-title"
          eyebrow="Covva in numbers"
          title="Launching with licensed partners, not promises."
          description={anyIllustrative ? "Figures update as the platform grows. Until real customer reviews are collected, the stories below are illustrative examples of how Covva is designed to work." : "Figures update as the platform grows. The stories below are from customers who agreed to be quoted."}
        />
        <StatsCounter items={STATS} />
        <div className="mt-10">
          <Testimonials items={testimonials} />
        </div>
      </Section>

      <PartnerCtaStrip />

      {/* Renewal reminder + roles -------------------------------------------------- */}
      <Section id="renewal-reminder" tone="mist" labelledBy="roles-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <SectionHeading
              id="roles-title"
              eyebrow="Who does what"
              title="Clear roles. One accountable broker."
              description="Insurance involves several parties. We show you who is responsible for what before you apply — and on every policy."
              className="mb-6! sm:mb-8!"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FeatureCard icon={<Layers />} title={<>{brand.name} <span className="font-normal text-muted">· technology</span></>}>{ROLE_STATEMENTS.platform}</FeatureCard>
              <FeatureCard icon={<UserRoundCheck />} title="Broker of record">{ROLE_STATEMENTS.broker}</FeatureCard>
              <FeatureCard icon={<Building2 />} title="Licensed insurer">{ROLE_STATEMENTS.insurer}</FeatureCard>
              <FeatureCard icon={<CreditCard />} title="Payment provider">{PAYMENTS_DISCLOSURE}</FeatureCard>
            </div>
            {(demo || anyDemoPartner) && <DemoBadge className="mt-4" />}
          </div>
          <div className="lg:pt-2">
            <RenewalReminderForm categories={reminderCategories} defaultCategory="motor" />
            <div className="mt-4 flex items-start gap-3 rounded-card border border-line bg-white p-4 text-[13.5px] leading-relaxed text-muted">
              <Wallet aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
              <p>Participating insurers: {directory.insurers.slice(0, 3).map((i) => displayOrgName(i.name)).join(", ")}{directory.insurers.length > 3 ? " and more" : ""}. <Link href="/partners" className="font-medium text-brand hover:underline">Full directory</Link>.</p>
            </div>
          </div>
        </div>
      </Section>

      {/* FAQ ---------------------------------------------------------------------- */}
      <Section labelledBy="faq-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <Eyebrow className="mb-3">Questions</Eyebrow>
            <h2 id="faq-title" className="text-h2 text-ink">Good to know</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">Straight answers to the questions people ask most.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/support" className={buttonClass("outline", "md")}>Visit the help centre</Link>
              <Link href="/learn" className={buttonClass("secondary", "md")}>Insurance guide</Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted"><Smartphone aria-hidden className="size-4 text-brand" /> Prefer to chat? Use the WhatsApp button on any page.</p>
          </div>
          <FaqList items={faqs} />
        </div>
      </Section>

      <div className="pt-4 sm:pt-6">
        <CtaBand title="Real quotes from licensed insurers, through your broker." body="Start with a quote, or answer a few questions and we’ll suggest the cover worth considering. A named broker is with you at every step." primary={{ label: "Get quotes", href: "/quote" }} secondary={{ label: "Help me choose", href: "/get-started" }} />
      </div>
    </>
  );
}
