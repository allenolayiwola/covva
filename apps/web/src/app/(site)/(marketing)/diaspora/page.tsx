import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, Church, Gift, Globe2, HeartHandshake, House, LayoutDashboard, Package, Users, Wallet } from "lucide-react";
import { Eyebrow, Pill, buttonClass } from "@im/ui";
import { getCategories } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { CurrencySwitcher } from "@/components/marketing/currency-switcher";
import { LeadForm } from "@/components/marketing/lead-form";
import { FaqList } from "@/components/marketing/faq-list";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";
import { CtaBand } from "@/components/marketing/cta-band";
import { QuoteWidget } from "@/components/marketing/quote-widget";
import { PaymentBadges } from "@/components/marketing/payment-badges";
import { DIASPORA_CURRENCIES, DIASPORA_STORIES } from "@/components/marketing/content";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "Insurance for family in Ghana — pay from abroad",
  description:
    "Look after your family in Ghana from anywhere. Pay in GBP, USD, EUR or CAD for parents’ health and funeral cover, the family car or the home you are building. Family dashboard, dual notifications, gift a policy, group plans for churches and associations.",
  alternates: { canonical: "/diaspora" },
  openGraph: { title: "Look after your family in Ghana from anywhere", description: "Pay in GBP, USD, EUR or CAD. Parents as beneficiaries, family dashboard, dual notifications, gift a policy.", url: "/diaspora", images: ["/opengraph-image"] },
};

const FEATURES = [
  { icon: Globe2, title: "Pay in GBP, USD, EUR or CAD", body: "Card payments in your own currency, with the price shown before you confirm. The insurer in Ghana receives cedis." },
  { icon: Users, title: "Parents and relatives as beneficiaries", body: "Add the people you look after. They are the policyholders or beneficiaries; you are the payer." },
  { icon: LayoutDashboard, title: "Family dashboard", body: "Every policy you pay for in one place: status, renewal dates, documents and claims — from any device." },
  { icon: BellRing, title: "Dual notifications", body: "You and your relative both get the certificate, reminders and claim updates by SMS, WhatsApp or email." },
  { icon: Gift, title: "Gift a policy", body: "Buy and pay, then hand the policy to a relative with one tap. They add their details; the insurer issues it." },
  { icon: House, title: "Property cover for homes being built", body: "Buildings-in-construction and finished-home cover for the house in Kumasi, Tema or the village." },
];

const FAQ = [
  { q: "Who is the policyholder — me or my relative in Ghana?", a: "Usually your relative in Ghana is the policyholder (or the life insured) and you are the payer. Both of you are named, both get notifications, and your relative can report claims directly. Some products allow the payer abroad to be the policyholder for property; your broker confirms what the insurer allows." },
  { q: "Which currencies can I pay in?", a: "GBP, USD, EUR and CAD by card, or GHS by mobile money. The price in your currency is shown at checkout before you pay; the insurer receives cedis." },
  { q: "Is the price higher for diaspora payers?", a: "No. The premium is the insurer’s cedi premium. You only see a currency conversion and any card processing fee, both shown before you confirm." },
  { q: "What is the Parents’ Care Pack?", a: "A bundle arranged by a participating broker: funeral cover for both parents plus a private health plan, paid together monthly or annually. It is priced per parent and age; you get one quote with everything itemised." },
  { q: "Can our church or association insure members’ families?", a: "Yes. Group plans let an organisation enrol members in bulk, pay one premium in its own currency and give every family its own policy in the app. Use the enquiry form on this page." },
  { q: "What if my relative needs to claim?", a: "They report it from the app or with their broker; you see every step on the family dashboard and can upload documents on their behalf." },
];

export default async function DiasporaPage() {
  const categories = await getCategories();
  const quoteCategories = categories.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, availability: c.availability }));
  const topics = [
    { value: "church", label: "Church or religious group" },
    { value: "association", label: "Hometown or alumni association" },
    { value: "employer", label: "Employer or union" },
    { value: "other", label: "Other group" },
  ];

  return (
    <>
      <JsonLd data={faqJsonLd(FAQ)} />
      <PageHero
        breadcrumb={[{ label: "Diaspora" }]}
        eyebrow={<span className="inline-flex items-center gap-2"><Globe2 aria-hidden className="size-4" /> For Ghanaians abroad</span>}
        title={<>Look after your family in Ghana <span className="text-brand">from anywhere.</span></>}
        lede="Pay in pounds, dollars, euros or Canadian dollars for the cover your parents, siblings and property need at home — and see every policy, reminder and claim from where you are."
        actions={
          <>
            <a href="#prices" className={buttonClass("primary", "lg")}>See prices in my currency</a>
            <a href="#group" className={buttonClass("secondary", "lg")}>Group & association plans</a>
          </>
        }
        aside={<QuoteWidget categories={quoteCategories} defaultSlug="life-funeral" title="Quote for family in Ghana" />}
      >
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="Currencies accepted">
          {DIASPORA_CURRENCIES.map((c) => (
            <li key={c.code} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-semibold text-ink-2">
              <span aria-hidden className="text-brand">{c.symbol}</span> {c.code}
            </li>
          ))}
        </ul>
      </PageHero>

      <Section labelledBy="features-title">
        <SectionHeading id="features-title" eyebrow="Built for families across borders" title="Everything a sponsor abroad needs" description="Designed with Ghanaians in London, New York, Toronto, Hamburg and beyond — and the families they look after." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} icon={<f.icon />} title={f.title}>{f.body}</FeatureCard>
          ))}
        </div>
      </Section>

      <Section id="prices" tone="mist" labelledBy="prices-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <Eyebrow className="mb-3">Localised pricing</Eyebrow>
            <h2 id="prices-title" className="text-balance text-[30px] leading-[1.12] md:text-[42px] text-ink">What it costs, in your currency</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">
              Example premiums for the things diaspora families insure most, converted at an indicative rate. Switch currency to see roughly what you would pay each month or year.
            </p>
            <CheckList className="mt-6" items={["No diaspora mark-up — the insurer’s cedi premium, converted", "Card fees shown before you confirm", "Cancel or change the payment method at any time"]} />
            <PaymentBadges compact className="mt-6" />
          </div>
          <CurrencySwitcher />
        </div>
      </Section>

      <Section labelledBy="bundles-title">
        <SectionHeading id="bundles-title" eyebrow="Bundles" title="Popular ways to cover the people back home" />
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="flex flex-col rounded-[20px] border border-brand bg-white p-6 shadow-float sm:p-7">
            <div className="flex items-center justify-between">
              <IconTile tone="brand"><Package /></IconTile>
              <Pill tone="ok">Most popular</Pill>
            </div>
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">Parents’ Care Pack</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Funeral cover, a private health plan and personal accident cover for one or both parents, quoted together and paid as one monthly amount by you.</p>
            <CheckList className="mt-5" items={["Entry ages up to 70+ on selected plans", "One monthly or annual payment", "Both parents get their own membership cards", "You and they get every notification"]} />
            <Link href="/get-started?category=life-funeral&people=2" className={buttonClass("primary", "md", "mt-6")}>Price a Care Pack <ArrowRight aria-hidden className="size-4" /></Link>
          </article>
          <article className="flex flex-col rounded-[20px] border border-line bg-white p-6 sm:p-7">
            <IconTile><House /></IconTile>
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">Home being built</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Cover the house under construction against fire, flood, theft of materials and collapse, then switch to a standard home policy when it is finished.</p>
            <CheckList className="mt-5" items={["Insure the value of work completed", "Add contents when the family moves in", "Photos from the site uploaded by a relative"]} />
            <Link href="/insurance/home" className={buttonClass("secondary", "md", "mt-auto pt-0")}>Home & contents <ArrowRight aria-hidden className="size-4" /></Link>
          </article>
          <article className="flex flex-col rounded-[20px] border border-line bg-white p-6 sm:p-7">
            <IconTile><Church /></IconTile>
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">Group plans for churches & associations</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Enrol members in bulk, pay one group premium in your currency and give every family its own funeral or health policy in the app.</p>
            <CheckList className="mt-5" items={["Welfare committee dashboard: who is paid up, who is in arrears", "Members join by link and add beneficiaries themselves", "Relatives abroad pay a member's contributions in their currency"]} />
            <div className="mt-auto flex flex-wrap gap-2">
              <Link href="/account/groups/new" className={buttonClass("secondary", "md")}>Set up a welfare group <ArrowRight aria-hidden className="size-4" /></Link>
              <a href="#group" className={buttonClass("ghost", "md")}>Ask a broker first</a>
            </div>
          </article>
        </div>
      </Section>

      <Section tone="mist" labelledBy="stories-title">
        <SectionHeading id="stories-title" eyebrow="Stories and use cases" title="How families use Covva across borders" description="Illustrative examples of how the product is designed to work — not reviews from named customers." />
        <ul className="grid gap-4 md:grid-cols-3">
          {DIASPORA_STORIES.map((s) => (
            <li key={s.id} className="flex flex-col rounded-card border border-line bg-white p-6">
              <div className="flex items-center justify-between gap-3">
                <Pill>{s.tag}</Pill>
                <Pill tone="wait">Illustrative</Pill>
              </div>
              <h3 className="mt-4 text-[20px] leading-[1.25] md:text-[24px] text-ink">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="how-title">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading id="how-title" eyebrow="How it works from abroad" title="Four steps, from your phone" className="mb-6! sm:mb-6!" />
            <ol className="space-y-3">
              {[
                "Get a quote for your relative — their details, your payment.",
                "Add them as the policyholder or beneficiary with their Ghana Card number.",
                "Pay by card in your currency. The insurer issues the policy to both wallets.",
                "Follow renewals and claims on your family dashboard; your relative uses the app in Ghana.",
              ].map((s, i) => (
                <li key={s} className="flex gap-4 rounded-card border border-line bg-white p-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold tabular-nums text-white">{i + 1}</span>
                  <p className="pt-1 text-[15px] leading-relaxed text-ink-2">{s}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureCard icon={<HeartHandshake />} title="A broker who calls Ghana">Your named broker speaks to your relative in Ghana directly — in English, Twi, Ga or Ewe — so nothing gets lost.</FeatureCard>
            <FeatureCard icon={<Wallet />} title="Documents in both wallets">Certificates, wording and receipts appear for the payer and the policyholder, available offline.</FeatureCard>
            <FeatureCard icon={<BellRing />} title="Reminders before anything lapses">45, 30, 14, 7 and 1 day before cover ends, to both of you.</FeatureCard>
            <FeatureCard icon={<Gift />} title="Gift at Christmas or Homowo">Buy a policy as a gift and schedule when the relative receives it.</FeatureCard>
          </div>
        </div>
      </Section>

      <Section id="group" tone="mist" labelledBy="group-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="group-title" eyebrow="Group & association enquiry" title="Cover your members’ families in Ghana" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Tell us about your church, hometown association, alumni group or union. A participating broker will design a group plan and quote one premium in your currency.
            </p>
            <CheckList className="mt-6" items={["Typically 20+ members", "Funeral, health or personal accident cover", "Bulk enrolment by spreadsheet or link", "Committee dashboard and reporting"]} />
            <Link href="/business" className={`${textLinkClass} mt-6`}>Employer or SME? See business cover <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
          <LeadForm
            kind="enterprise"
            tag="diaspora_group"
            organization="required"
            organizationLabel="Group or association name"
            topicLabel="Type of group"
            topics={topics}
            messageLabel="About your group"
            messagePlaceholder="Where you are based, roughly how many members, and the kind of cover you have in mind for families in Ghana."
            submitLabel="Request a group quote"
            successBody="Thank you. A broker who works with diaspora groups will contact you within two working days."
          />
        </div>
      </Section>

      <Section labelledBy="diaspora-faq-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <h2 id="diaspora-faq-title" className="text-[30px] leading-[1.12] md:text-[42px] text-ink">Diaspora questions</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-muted">Something else? <Link href="/support" className="font-medium text-brand hover:underline">Visit the help centre</Link> or use the WhatsApp button.</p>
          </div>
          <FaqList items={FAQ} />
        </div>
      </Section>

      <CtaBand
        title="Look after your family in Ghana from anywhere."
        body="Get a quote for a parent, the family car or the house you are building. Pay in your currency; they get the policy in theirs."
        primary={{ label: "Get a quote", href: "/get-started?category=life-funeral" }}
        secondary={{ label: "Read the diaspora guide", href: "/learn/insurance-for-diaspora-families" }}
      />
    </>
  );
}
