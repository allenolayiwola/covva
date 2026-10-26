import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  BellRing,
  Building2,
  CircleHelp,
  CreditCard,
  FileText,
  Handshake,
  Languages,
  Layers,
  ListChecks,
  MessageCircle,
  RotateCw,
  Scale,
  Search,
  ShieldCheck,
  Smartphone,
  UserRoundCheck,
  Wallet,
  WifiOff,
} from "lucide-react";
import { DemoBadge, DisclosureBlock, Eyebrow, Pill, buttonClass } from "@im/ui";
import { CATEGORY_AVAILABILITY, ROLE_STATEMENTS, buildDisclosure } from "@im/core";
import { getCategories, getPartnerDirectory } from "@/lib/catalog";
import { displayOrgName, getBrand, isDemoMode, isDemoOrg } from "@/components/marketing/brand";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { CategoryTile } from "@/components/marketing/category-card";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { PhoneMock } from "@/components/marketing/phone-mock";
import { FaqList } from "@/components/marketing/faq-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { OrgTile } from "@/components/marketing/org-tile";
import { HOME_FAQ_IDS, REGULATION, findFaq } from "@/components/marketing/content";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: { absolute: "Insurance Marketplace — Find cover. Understand it. Move forward." },
  description:
    "A clearer way to explore insurance in Ghana. Compare cover from participating licensed insurers, with a named broker by your side from first question to policy delivery.",
  alternates: { canonical: "/" },
};

const STEPS = [
  { icon: ListChecks, title: "Assess", body: "Answer a few plain questions, or pick the cover you already know you need." },
  { icon: Scale, title: "Compare", body: "See cover, limits, excesses and exclusions side by side — not just the price." },
  { icon: Handshake, title: "Choose with your broker", body: "Your named broker checks your needs and confirms the final quote with the insurer." },
  { icon: CreditCard, title: "Pay securely", body: "Pay by mobile money or card through an authorised provider, directly to the insurer." },
  { icon: Wallet, title: "Manage, renew & claim", body: "Keep documents in your wallet, get renewal reminders and help when you claim." },
];

const COMPARE_POINTS = [
  { term: "Premium", body: "What you pay, and how often." },
  { term: "Cover", body: "The events and costs the policy pays for." },
  { term: "Limits", body: "The most the insurer will pay, overall and per item." },
  { term: "Exclusions", body: "What is not covered, in plain language." },
  { term: "Excesses", body: "The part of each claim you pay yourself." },
  { term: "Waiting periods", body: "How long before some benefits can be claimed." },
  { term: "Important conditions", body: "What you must do to keep cover valid." },
  { term: "Quote validity", body: "When the quote was made and until when it stands." },
];

const GHANA = [
  { icon: Smartphone, title: "Mobile money first", body: "Pay premiums with mobile money or card, through an authorised payment provider." },
  { icon: WifiOff, title: "Light on data", body: "Fast pages and forms that save as you go, so a dropped connection never costs you your progress." },
  { icon: Languages, title: "Plain language", body: "Every term explained simply, with the policy wording one tap away." },
  { icon: UserRoundCheck, title: "A real person", body: "Hand over to your named broker whenever you want a human." },
  { icon: MessageCircle, title: "WhatsApp, coming", body: "WhatsApp-assisted service is planned once it is approved for safe use.", soon: true },
];

export default async function HomePage() {
  const [categories, directory, demo, brand] = await Promise.all([getCategories(), getPartnerDirectory(), isDemoMode(), getBrand()]);

  const preferred = ["coastline-general", "volta-mutual", "ashanti-shield"];
  const heroInsurers = preferred
    .map((slug) => directory.insurers.find((i) => i.slug === slug))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .concat(directory.insurers.filter((i) => !preferred.includes(i.slug)))
    .slice(0, 3)
    .map((i) => ({ name: i.name, color: i.brand_color }));

  const tiles = categories.slice(0, 9);
  const broker = directory.brokers[0];
  const insurer = directory.insurers.find((i) => i.slug === "coastline-general") ?? directory.insurers[0];
  const disclosure = buildDisclosure({
    platform: brand.name,
    broker: { name: broker ? displayOrgName(broker.name) : "Demo Broker", licence: broker?.nic_licence_number ?? "NIC/DEMO/BRK/001" },
    insurer: { name: insurer ? displayOrgName(insurer.name) : "Coastline General" },
  });
  const partnerOrgs = [...directory.insurers.slice(0, 4), ...directory.brokers.slice(0, 2)];
  const anyDemoPartner = partnerOrgs.some((o) => isDemoOrg(o.settings));
  const faqs = findFaq(HOME_FAQ_IDS);

  return (
    <>
      {/* Hero ------------------------------------------------------------------ */}
      <section aria-labelledby="hero-title" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-mist/70 to-white" />
        <div className="relative mx-auto grid w-full max-w-[1200px] gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-center lg:gap-10 lg:px-8 lg:pb-24 lg:pt-20">
          <div className="motion-safe:animate-fade-up">
            <Eyebrow>Insurance for everyday life in Ghana</Eyebrow>
            <h1 id="hero-title" className="mt-5 text-[46px] font-bold leading-[1.0] tracking-[-0.045em] text-ink sm:text-[64px] lg:text-[72px]">
              Find cover.
              <br />
              Understand it.
              <br />
              <span className="text-brand">Move forward.</span>
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted sm:text-xl">
              A clearer way to explore insurance, with a named broker by your side from first question to policy delivery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/get-started" className={buttonClass("primary", "lg")}>
                What do I need?
              </Link>
              <Link href="/how-it-works" className={buttonClass("secondary", "lg")}>
                See how it works
              </Link>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted">
              <li className="flex items-center gap-2"><ShieldCheck aria-hidden className="size-4 text-brand" />Licensed brokers & insurers</li>
              <li className="flex items-center gap-2"><Banknote aria-hidden className="size-4 text-brand" />Premiums paid to the insurer</li>
              <li className="flex items-center gap-2"><Search aria-hidden className="size-4 text-brand" />No obligation to buy</li>
            </ul>
          </div>
          <HeroVisual insurers={heroInsurers} demo={demo} />
        </div>
      </section>

      {/* Categories ------------------------------------------------------------- */}
      <Section labelledBy="cover-title" className="pt-4! sm:pt-6!">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="cover-title" className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">Cover for what matters to you</h2>
          <p className="text-sm text-muted">Availability depends on approved insurer arrangements.</p>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {tiles.map((c) => (
            <li key={c.id}>
              <CategoryTile category={c} className="h-full" />
            </li>
          ))}
          <li>
            <Link
              href="/explore"
              className="flex h-full min-h-[124px] flex-col justify-between rounded-card border border-dashed border-brand/40 bg-mist p-5 text-brand-deep transition-colors hover:bg-mint-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <Layers aria-hidden className="size-6" strokeWidth={1.75} />
              <span className="mt-6 flex items-center justify-between text-[17px] font-semibold">
                Explore all cover
                <ArrowRight aria-hidden className="size-4" />
              </span>
            </Link>
          </li>
        </ul>
        <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
          {(["integrated", "broker_assisted", "planned"] as const).map((k) => (
            <span key={k} className="flex items-center gap-2">
              <Pill tone={CATEGORY_AVAILABILITY[k].tone}>{CATEGORY_AVAILABILITY[k].label}</Pill>
              <span className="max-w-[19rem]">{k === "integrated" ? "Compare and pay online" : k === "broker_assisted" ? "Structured request with a named adviser" : "Labelled, not yet sold"}</span>
            </span>
          ))}
        </p>
      </Section>

      {/* Two ways to start ------------------------------------------------------ */}
      <Section tone="mist" labelledBy="start-title">
        <SectionHeading id="start-title" eyebrow="Two ways to start" title="Not sure, or know exactly what you need?" description="Either way, you can stop at any point and pick up where you left off." />
        <div className="grid gap-5 md:grid-cols-2">
          <Link href="/get-started" className="group relative flex flex-col overflow-hidden rounded-[24px] bg-brand-deep p-7 text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none sm:p-9">
            <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full bg-white/[0.06]" />
            <IconTile tone="white"><CircleHelp /></IconTile>
            <h3 className="mt-6 text-2xl font-semibold tracking-tight">Help me choose</h3>
            <p className="mt-2 max-w-md text-[16px] leading-relaxed text-white/80">
              Eight quick questions about your life, work and what you own. We suggest the cover worth considering and explain why. No sign-in needed.
            </p>
            <span className="mt-8 inline-flex items-center gap-2 font-semibold">
              Start — about 2 minutes
              <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" />
            </span>
          </Link>
          <div className="flex flex-col rounded-[24px] border border-line bg-white p-7 sm:p-9">
            <IconTile><Scale /></IconTile>
            <h3 className="mt-6 text-2xl font-semibold tracking-tight text-ink">Compare a category you know</h3>
            <p className="mt-2 max-w-md text-[16px] leading-relaxed text-muted">
              Go straight to quotes. Tell us about the risk once and your broker gets quotes from participating insurers.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {categories
                .filter((c) => c.availability !== "planned")
                .slice(0, 6)
                .map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/account/requests/new?category=${c.slug}`}
                      className="inline-flex h-9 items-center rounded-full border border-line bg-white px-3.5 text-sm font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
            </ul>
            <Link href="/explore" className={`${textLinkClass} mt-auto pt-8`}>
              See all categories <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </Section>

      {/* How it works ------------------------------------------------------------ */}
      <Section labelledBy="how-title">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="From first question to policy delivery"
          description="Five clear steps, with a licensed broker accountable for your request throughout."
          action={<Link href="/how-it-works" className={textLinkClass}>The full journey <ArrowRight aria-hidden className="size-4" /></Link>}
        />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-card border border-line bg-white p-6">
              <div className="flex items-center justify-between">
                <IconTile><s.icon /></IconTile>
                <span className="text-sm font-semibold tabular-nums text-subtle">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight text-ink">{s.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* More than a premium ----------------------------------------------------- */}
      <Section tone="mist" labelledBy="compare-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <Eyebrow className="mb-3">More than a premium</Eyebrow>
            <h2 id="compare-title" className="text-balance text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[40px]">
              Compare the cover, not just the price.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">
              The cheapest policy is not always the one that pays when you need it. Every comparison lines up the details that decide what you actually get.
            </p>
            <CheckList
              className="mt-8"
              items={[
                "We tell you how many insurers and products were compared — never “the whole market”.",
                "No unexplained “best” labels. Any ranking says what it is based on.",
                "Paid placements, if ever shown, are labelled and kept out of the ranking.",
                "Every quote is time-stamped and checked again before you pay.",
              ]}
            />
          </div>
          <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
            {COMPARE_POINTS.map((p, i) => (
              <div key={p.term} className="bg-white p-5 sm:p-6">
                <dt className="flex items-center gap-3 text-[16px] font-semibold text-ink">
                  <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-mint text-xs font-semibold tabular-nums text-brand-deep">{i + 1}</span>
                  {p.term}
                </dt>
                <dd className="mt-2 text-[14.5px] leading-relaxed text-muted">{p.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {/* Who does what ----------------------------------------------------------- */}
      <Section labelledBy="roles-title">
        <SectionHeading
          id="roles-title"
          eyebrow="Who does what"
          title="Clear roles. One accountable broker."
          description="Insurance involves several parties. We show you who is responsible for what before you apply — and on every policy."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<Layers />} title={<>Technology partner <span className="font-normal text-muted">· {brand.name}</span></>}>{ROLE_STATEMENTS.platform}</FeatureCard>
          <FeatureCard icon={<UserRoundCheck />} title="Broker of record">{ROLE_STATEMENTS.broker}</FeatureCard>
          <FeatureCard icon={<Building2 />} title="Licensed insurer">{ROLE_STATEMENTS.insurer}</FeatureCard>
        </div>
        <div className="mt-4 flex flex-col gap-4 rounded-card border border-line bg-mist p-5 sm:flex-row sm:items-center sm:p-6">
          <IconTile tone="white"><CreditCard /></IconTile>
          <p className="text-[15px] leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">Payment provider. </span>
            {ROLE_STATEMENTS.payment} We never hold your premium.
          </p>
        </div>
        <div className="mt-8">
          <p className="mb-2 text-sm font-medium text-muted">What you see before you apply — example:</p>
          <DisclosureBlock text={disclosure} />
          {demo && <DemoBadge className="mt-2" />}
        </div>
      </Section>

      {/* Wallet, renewals, claims ------------------------------------------------- */}
      <Section tone="mist" labelledBy="wallet-title" className="overflow-hidden">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div>
            <Eyebrow className="mb-3">After you buy</Eyebrow>
            <h2 id="wallet-title" className="text-balance text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[40px]">
              Your cover wallet, renewals and claims help — in one place.
            </h2>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted">
              Insurance does not end at payment. Keep every document to hand, know what needs your attention, and get your broker’s help when something goes wrong.
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                { icon: Wallet, title: "Cover wallet", body: "Schedules, certificates and wording issued by the insurer, available offline." },
                { icon: BellRing, title: "Renewal reminders", body: "Reminders from 45 days out, and a review of what has changed. Prices labelled as estimates until confirmed." },
                { icon: FileText, title: "Claims assistance", body: "Report a claim with photos and documents. Your broker submits it; the insurer decides — you see every step." },
              ].map((f) => (
                <div key={f.title}>
                  <IconTile tone="white"><f.icon /></IconTile>
                  <h3 className="mt-4 font-semibold text-ink">{f.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 inline-flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3">
              <Smartphone aria-hidden className="size-5 text-brand" />
              <p className="text-sm text-ink-2">
                <span className="font-semibold text-ink">Mobile app for iOS and Android</span> — coming at launch.
              </p>
            </div>
          </div>
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-0 m-auto size-[380px] rounded-full bg-mint-2 blur-2xl" />
            <PhoneMock className="relative" insurers={heroInsurers.map((i) => i.name)} />
            <p className="sr-only">Illustration of the My cover screen: an active motor policy, quick actions for documents, claims and calling your broker, and a renewal reminder.</p>
          </div>
        </div>
      </Section>

      {/* Designed for Ghana ------------------------------------------------------- */}
      <Section labelledBy="ghana-title">
        <SectionHeading id="ghana-title" eyebrow="Designed for Ghana" title="Built for how people here actually live, work and pay." />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {GHANA.map((g) => (
            <li key={g.title} className="rounded-card border border-line bg-white p-6">
              <div className="flex items-start justify-between">
                <IconTile><g.icon /></IconTile>
                {g.soon && <Pill>Coming</Pill>}
              </div>
              <h3 className="mt-5 font-semibold tracking-tight text-ink">{g.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{g.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* Trust strip -------------------------------------------------------------- */}
      <section aria-labelledby="trust-title" className="border-y border-line bg-mist">
        <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)] lg:items-center lg:px-8">
          <div>
            <h2 id="trust-title" className="text-xl font-bold tracking-tight text-ink">Regulation & customer protection</h2>
            <Link href="/trust" className={`${textLinkClass} mt-2 text-sm`}>How we protect you <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-3">
            {[
              { title: REGULATION.nic.name, body: "Participating brokers and insurers are licensed by the NIC. You can verify any licence." },
              { title: REGULATION.act1061, body: "The law governing insurers, brokers and the protection of policyholders in Ghana." },
              { title: REGULATION.act843, body: "How we collect, use and protect your personal data, and your rights over it." },
            ].map((t) => (
              <li key={t.title} className="flex gap-3">
                <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                <div>
                  <p className="text-[15px] font-semibold text-ink">{t.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{t.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Partners ----------------------------------------------------------------- */}
      <Section labelledBy="partners-title">
        <SectionHeading
          id="partners-title"
          eyebrow="Participating insurers & brokers"
          title="Who you can compare today"
          description={`${directory.insurers.length} participating insurer${directory.insurers.length === 1 ? "" : "s"} and ${directory.brokers.length} broker${directory.brokers.length === 1 ? "" : "s"}. We add partners only after licence checks and a signed agreement.`}
          action={<Link href="/partners" className={textLinkClass}>Full directory <ArrowRight aria-hidden className="size-4" /></Link>}
        />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {partnerOrgs.map((o) => (
            <li key={o.id} className="flex items-center gap-4 rounded-card border border-line bg-white p-4">
              <OrgTile name={o.name} color={o.brand_color} size={44} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{displayOrgName(o.name)}</p>
                <p className="truncate text-[13px] text-muted">
                  {o.type === "insurer" ? "Insurer" : "Broker"}
                  {o.nic_licence_number ? ` · Licence ${o.nic_licence_number}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {(demo || anyDemoPartner) && <DemoBadge className="mt-4" />}
      </Section>

      {/* FAQ ---------------------------------------------------------------------- */}
      <Section tone="mist" labelledBy="faq-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <Eyebrow className="mb-3">Questions</Eyebrow>
            <h2 id="faq-title" className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[40px]">Good to know</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">Straight answers to the questions people ask most.</p>
            <Link href="/support" className={`${buttonClass("outline", "md")} mt-8`}>Visit the help centre</Link>
          </div>
          <FaqList items={faqs} />
        </div>
      </Section>

      <div className="pt-16 sm:pt-24">
        <CtaBand title="Find cover. Understand it. Move forward." />
      </div>
    </>
  );
}
