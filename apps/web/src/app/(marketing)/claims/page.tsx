import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, Clock, FileCheck2, Hospital, Info, PhoneCall, ShieldAlert, Smartphone, Wrench } from "lucide-react";
import { Notice, Pill, buttonClass } from "@im/ui";
import { CLAIM_DISCLAIMER } from "@im/core";
import { getBrand } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { FaqList } from "@/components/marketing/faq-list";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";
import { StoreBadges } from "@/components/marketing/store-badges";
import { findFaq } from "@/components/marketing/content";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "How to make a claim",
  description: "How to make an insurance claim through Covva, step by step: what to do first, what to send, typical timelines, and the partner garage and hospital network. Start a claim in the app.",
  alternates: { canonical: "/claims" },
};

const STEPS = [
  { icon: ShieldAlert, title: "Make people safe, then report to the authorities", body: "For accidents with injuries, theft or fire, get a police or fire service report number. For a death, obtain the death certificate." },
  { icon: Smartphone, title: "Report the claim in the app", body: "Open the policy in your Covva wallet and tap Report a claim. Tell us what happened, when and where. Works on slow connections — it saves as you go." },
  { icon: Camera, title: "Add photos and documents", body: "Photos of the damage, receipts, the police report, hospital notes. The app lists exactly what the insurer needs for your type of claim." },
  { icon: FileCheck2, title: "Your broker checks and submits", body: "A named broker reviews the file for gaps and sends it to the insurer. You see when it is delivered — uploading is not the same as the insurer receiving it." },
  { icon: Clock, title: "The insurer assesses and decides", body: "They may call you, send an assessor or ask for more. Respond quickly to keep it moving. The decision and the reasons are shown in the app." },
  { icon: PhoneCall, title: "Payment or repair", body: "Approved claims are paid to your MoMo wallet or bank, or directly to the garage or hospital, less any excess." },
];

const TIMELINES = [
  { type: "Acknowledgement", time: "Within 1 working day" },
  { type: "Funeral benefit", time: "48–72 hours after a complete claim" },
  { type: "Hospital cash / micro", time: "3–5 working days" },
  { type: "Motor own-damage", time: "5–10 working days after assessment" },
  { type: "Health reimbursement", time: "10–14 working days" },
  { type: "Home contents", time: "About 10 working days" },
  { type: "Travel", time: "About 14 working days" },
  { type: "Business / adjusted claims", time: "Depends on the loss adjuster" },
];

export default async function ClaimsPage() {
  const brand = await getBrand();
  const faq = findFaq(["how-claim", "who-decides", "declined"]);
  return (
    <>
      <JsonLd data={faqJsonLd(faq)} />
      <PageHero
        breadcrumb={[{ label: "Claims" }]}
        eyebrow="Claims"
        title={<>Something happened? <span className="text-brand">Here’s what to do.</span></>}
        lede="Report in minutes from your phone, with your broker checking the file and the insurer deciding — and every step visible to you."
        actions={
          <>
            <Link href="/account/claims" className={buttonClass("primary", "lg")}>Start a claim in the app <ArrowRight aria-hidden className="size-4" /></Link>
            <a href="#steps" className={buttonClass("secondary", "lg")}>Step by step</a>
          </>
        }
        aside={
          <div className="rounded-[24px] border border-line bg-white p-6 shadow-float sm:p-7">
            <p className="text-sm font-semibold text-ink">Emergency first</p>
            <ul className="mt-3 space-y-2 text-[15px] text-ink-2">
              <li className="flex gap-2"><span aria-hidden className="font-semibold text-brand">191</span> Police</li>
              <li className="flex gap-2"><span aria-hidden className="font-semibold text-brand">192</span> Fire service</li>
              <li className="flex gap-2"><span aria-hidden className="font-semibold text-brand">193</span> Ambulance</li>
            </ul>
            <p className="mt-4 text-[13px] leading-relaxed text-muted">Travelling abroad? Call the 24-hour assistance line printed on your travel certificate before you get treatment.</p>
            <p className="mt-4 text-[13px] text-muted">Questions: <a href={`mailto:${brand.supportEmail}`} className="font-medium text-brand hover:underline">{brand.supportEmail}</a></p>
          </div>
        }
      />

      <Section id="steps" labelledBy="steps-title">
        <SectionHeading id="steps-title" eyebrow="Step by step" title="How to make a claim" description={CLAIM_DISCLAIMER} />
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-card border border-line bg-white p-6">
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

      <Section tone="mist" labelledBy="timelines-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="timelines-title" eyebrow="Typical timelines" title="How long claims usually take" className="mb-6! sm:mb-6!" />
            <p className="text-[16px] leading-relaxed text-muted">Times run from a complete file — the fastest way to a decision is sending everything the insurer asks for the first time. Each insurer publishes its own service standards; these are typical ranges.</p>
            <Notice tone="info" icon={<Info className="size-4" />} className="mt-6">
              The insurer decides every claim. If you disagree with a decision, ask for the reasons and the clause relied on — then use the <Link href="/legal/complaints" className="font-medium underline underline-offset-2">complaints procedure</Link>, and the NIC if needed.
            </Notice>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
            {TIMELINES.map((t) => (
              <div key={t.type} className="bg-white p-5">
                <dt className="text-[15px] font-semibold text-ink">{t.type}</dt>
                <dd className="mt-1 text-[14.5px] text-muted">{t.time}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section labelledBy="network-title">
        <SectionHeading id="network-title" eyebrow="Partner network" title="Garages and hospitals that work with your insurer" action={<Pill tone="wait">Coming at launch</Pill>} />
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<Wrench />} title="Approved garages">Insurers settle repairs directly with their approved garages in Accra, Kumasi, Takoradi and Tamale. The app will show the nearest one to you and let you book the assessment.</FeatureCard>
          <FeatureCard icon={<Hospital />} title="Hospital networks">Health plans pay the hospital directly: show your digital membership card at a network hospital. The network list will be searchable in the app and on this page.</FeatureCard>
          <FeatureCard icon={<PhoneCall />} title="Roadside and assistance">Towing, roadside help and 24-hour travel assistance lines, where your policy includes them, one tap from your wallet.</FeatureCard>
        </div>
        <p className="mt-6 text-[14px] text-muted">Network directories are published as each insurer confirms them — <Link href="/claims/network" className={textLinkClass}>browse the approved partner network by region</Link>. Until a partner is listed near you, your broker tells you where to go when you report a claim.</p>
      </Section>

      <Section tone="mist" labelledBy="app-claims-title">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading id="app-claims-title" eyebrow="In the app" title="Start a claim in the Covva app" className="mb-6! sm:mb-6!" />
            <CheckList items={["Photos straight from your camera, compressed for mobile data", "A checklist of documents for your type of claim", "See when your broker submits and when the insurer receives it", "Messages with your broker in the claim thread", "Payment status until the money lands"]} />
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/account/claims" className={buttonClass("primary", "lg")}>Start a claim <ArrowRight aria-hidden className="size-4" /></Link>
              <StoreBadges size="sm" />
            </div>
            <p className="mt-4 text-[13px] text-muted">No app? Sign in on the web at covva.com.gh/account — it works on any phone browser.</p>
          </div>
          <div>
            <h3 className="text-[19px] font-semibold tracking-tight text-ink">Claims questions</h3>
            <FaqList items={faq} className="mt-4" />
            <Link href="/learn/how-to-make-a-claim" className={`${textLinkClass} mt-5`}>Read the full claims guide <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
        </div>
      </Section>
    </>
  );
}
