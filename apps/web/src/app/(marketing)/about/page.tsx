import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Compass, Eye, Layers, LockKeyhole, Mail, MessageSquareWarning, Scale, ShieldCheck, UserRoundCheck, Users } from "lucide-react";
import { Avatar, Eyebrow, Notice, Pill } from "@im/ui";
import { ROLE_STATEMENTS } from "@im/core";
import { getBrand } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { CtaBand } from "@/components/marketing/cta-band";
import { REGULATION } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Our vision is to be Ghana’s most trusted independent insurance access point. Learn how we work with licensed brokers and insurers, and how we are governed.",
  alternates: { canonical: "/about" },
};

const PRINCIPLES = [
  { icon: Eye, title: "Clarity over persuasion", body: "We explain cover in plain language and show the details that matter, not just the price." },
  { icon: UserRoundCheck, title: "Human help built in", body: "Every request has a named, licensed broker. Technology supports advice; it never replaces it." },
  { icon: Scale, title: "Integrity in comparison", body: "We say how many insurers we compared, label paid placements and never claim the whole market." },
  { icon: ShieldCheck, title: "Safety before speed", body: "We open a category only when advice, underwriting, payment and claims can all support it." },
];

const COMMITTEES = [
  { title: "Board of directors", body: "Sets strategy and risk appetite, and oversees management." },
  { title: "Risk & compliance committee", body: "Regulatory engagement, conduct risk, partner due diligence and complaints oversight." },
  { title: "Comparison integrity committee", body: "Ranking methods, labels, paid placement separation and product-data quality." },
  { title: "Data protection & security", body: "Privacy, information security, incident response and data-subject requests." },
];

const POLICIES = [
  "Conduct and customer fairness policy",
  "Comparison and ranking methodology",
  "Conflicts of interest and remuneration disclosure",
  "Complaints handling procedure",
  "Data protection and retention policy",
  "Information security policy",
  "Partner due-diligence and onboarding policy",
  "Responsible AI policy",
  "Anti-money-laundering and fraud policy",
];

export default async function AboutPage() {
  const brand = await getBrand();
  return (
    <>
      <PageHero
        breadcrumb={[{ label: "About us" }]}
        eyebrow="About us"
        title={<>Ghana’s most trusted <span className="text-brand">independent insurance access point.</span></>}
        lede={`That is the ambition behind ${brand.name}. Insurance protects livelihoods — but only when people understand it, trust it and can get help when they need it. We are building the platform that makes that normal.`}
      />

      <Section labelledBy="vision-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <Eyebrow className="mb-3">Why we exist</Eyebrow>
            <h2 id="vision-title" className="text-[30px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[38px]">{brand.tagline}</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-muted">
              Too many people in Ghana go without cover, or hold policies they do not understand. Buying is slow, comparing is hard, and help after the sale is patchy. We think a clear, trustworthy digital front door — backed by licensed professionals — can change that.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <FeatureCard key={p.title} icon={<p.icon />} title={p.title}>{p.body}</FeatureCard>
            ))}
          </div>
        </div>
      </Section>

      <Section tone="mist" labelledBy="model-title">
        <SectionHeading id="model-title" eyebrow="How Covva works" title="A technology platform working alongside licensed professionals" description={`${brand.name} is a technology platform. We are not an insurer and not a broker. Policies are provided by insurers licensed by the National Insurance Commission and arranged by licensed brokers.`} />
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<Layers />} title="Us — technology">{ROLE_STATEMENTS.platform}</FeatureCard>
          <FeatureCard icon={<UserRoundCheck />} title="Brokers — advice">{ROLE_STATEMENTS.broker}</FeatureCard>
          <FeatureCard icon={<Building2 />} title="Insurers — cover">{ROLE_STATEMENTS.insurer}</FeatureCard>
        </div>
        <p className="mt-6 text-sm text-muted">
          We earn technology fees from partner brokers and insurers. We do not earn more by steering you to a particular insurer. See our{" "}
          <Link href="/legal/disclosures" className="font-medium text-brand hover:underline">disclosures</Link>.
        </p>
      </Section>

      <Section labelledBy="status-title">
        <SectionHeading id="status-title" eyebrow="Regulatory status, data and complaints" title="Where we stand" />
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<ShieldCheck />} title="Regulatory status">
            We operate as a technology provider. Our classification is being confirmed with the {REGULATION.nic.name}. Broking is done only by NIC-licensed brokers; policies are issued only by insurers licensed under the {REGULATION.act1061}.{" "}
            <Link href="/trust#licensing" className="font-medium text-brand hover:underline">Details</Link>
          </FeatureCard>
          <FeatureCard icon={<LockKeyhole />} title="Data protection (Act 843)">
            Personal data is processed under the {REGULATION.act843}. We collect only what is needed to arrange and service insurance, never sell it, and honour access, correction and deletion requests.{" "}
            <Link href="/legal/privacy" className="font-medium text-brand hover:underline">Privacy notice</Link>
          </FeatureCard>
          <FeatureCard icon={<MessageSquareWarning />} title="Complaints">
            Raise a complaint with your broker, then with us at {brand.supportEmail}; we aim to resolve within 14 days. Unresolved complaints can be escalated to the NIC Complaints Bureau.{" "}
            <Link href="/legal/complaints" className="font-medium text-brand hover:underline">Complaints procedure</Link>
          </FeatureCard>
        </div>
        <Notice tone="info" className="mt-6">
          <span className="inline-flex items-center gap-2"><Mail aria-hidden className="size-4" /> Contact: <a href={`mailto:${brand.supportEmail}`} className="font-medium underline underline-offset-2">{brand.supportEmail}</a> · <Link href="/contact" className="font-medium underline underline-offset-2">Contact form</Link> · <Link href="/press" className="font-medium underline underline-offset-2">Press & media kit</Link></span>
        </Notice>
      </Section>

      <Section tone="mist" labelledBy="gov-title">
        <SectionHeading id="gov-title" eyebrow="Governance" title="Accountable by design" description="Our governance framework is being established ahead of launch. Committee composition will be published once confirmed." />
        <div className="grid gap-8 lg:grid-cols-2">
          <ul className="grid gap-3 sm:grid-cols-2">
            {COMMITTEES.map((c) => (
              <li key={c.title} className="rounded-card border border-line bg-white p-5">
                <IconTile size="sm"><Compass /></IconTile>
                <h3 className="mt-3 font-semibold text-ink">{c.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{c.body}</p>
              </li>
            ))}
          </ul>
          <div className="rounded-card border border-line bg-mist p-6">
            <h3 className="font-semibold text-ink">Key policies</h3>
            <CheckList className="mt-4" items={POLICIES} />
          </div>
        </div>
      </Section>

      <Section labelledBy="team-title">
        <SectionHeading
          id="team-title"
          eyebrow="Team"
          title="The people behind the platform"
          action={<Pill tone="wait">Placeholder — to be confirmed</Pill>}
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {["Chief Executive", "Head of Partnerships", "Head of Compliance", "Head of Technology"].map((role) => (
            <li key={role} className="rounded-card border border-dashed border-line bg-white p-6 text-center">
              <Avatar initials="—" size={64} className="mx-auto" />
              <p className="mt-4 font-semibold text-ink">To be announced</p>
              <p className="text-sm text-muted">{role}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Users aria-hidden className="size-4 text-brand" />
          Interested in joining us? <Link href="/contact" className="font-medium text-brand hover:underline">Get in touch</Link>.
        </p>
      </Section>

      <div className="pt-16 sm:pt-24">
        <CtaBand
          title="Partner with us"
          body="We are working with a small group of licensed brokers and insurers ahead of launch."
          primary={{ label: "For brokers", href: "/brokers" }}
          secondary={{ label: "For insurers", href: "/insurers" }}
        />
      </div>
    </>
  );
}
