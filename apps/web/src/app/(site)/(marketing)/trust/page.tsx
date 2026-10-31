import { PAYMENTS_DISCLOSURE } from "@/components/marketing/payments-disclosure";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, CreditCard, ExternalLink, FileWarning, Landmark, Layers, LockKeyhole, Scale, UserRoundCheck } from "lucide-react";
import { DemoBadge, DisclosureBlock, Eyebrow, Notice } from "@im/ui";
import { ROLE_STATEMENTS, buildDisclosure } from "@im/core";
import { getPartnerDirectory } from "@/lib/catalog";
import { displayOrgName, getBrand, isDemoMode } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { REGULATION } from "@/components/marketing/content";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "Regulation & customer protection",
  description:
    "Who does what, our licensing position, how we keep comparisons fair, how we protect your data, and how to complain and escalate to the National Insurance Commission.",
  alternates: { canonical: "/trust" },
};

const INTEGRITY = [
  { title: "We say how many we compared", body: "Every comparison shows the number of participating insurers and products included, and which insurers did not respond." },
  { title: "No whole-market claims", body: "We compare participating insurers only. We never say or imply we cover every insurer in Ghana." },
  { title: "Paid placement kept separate", body: "If paid placements are ever shown, they are clearly labelled and never affect the ranking." },
  { title: "Commission disclosed", body: PAYMENTS_DISCLOSURE },
  { title: "Time-stamped quotes", body: "Each quote shows when it was made, its state and its validity date, and is checked again at checkout." },
  { title: "No unexplained “best”", body: "Labels like “Lowest price” say exactly what they mean. We never call a policy “the best” for you." },
];

export default async function TrustPage() {
  const [brand, directory, demo] = await Promise.all([getBrand(), getPartnerDirectory(), isDemoMode()]);
  const broker = directory.brokers[0];
  const insurer = directory.insurers[0];
  const example = buildDisclosure({
    platform: brand.name,
    broker: { name: broker ? displayOrgName(broker.name) : "Demo Broker", licence: broker?.nic_licence_number ?? "NIC/DEMO/BRK/001" },
    insurer: { name: insurer ? displayOrgName(insurer.name) : "Coastline General" },
  });

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Regulation & protection" }]}
        eyebrow="Regulation & customer protection"
        title={<>Trust is built on <span className="text-brand">clear answers.</span></>}
        lede="Who is responsible for what, how we are regulated, how we keep comparisons fair, how we protect your data — and what to do if something goes wrong."
      >
        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2 text-sm">
          {[
            ["#roles", "Who does what"],
            ["#licensing", "Licensing"],
            ["#integrity", "Comparison integrity"],
            ["#data", "Data protection"],
            ["#complaints", "Complaints"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border border-line bg-white px-4 py-2 font-medium text-ink-2 hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{label}</a>
          ))}
        </nav>
      </PageHero>

      <Section id="roles" labelledBy="roles-title">
        <SectionHeading id="roles-title" eyebrow="Who does what" title="Four parties, clearly separated" description="Policies are provided by licensed insurers and arranged by licensed brokers. Covva provides the technology that connects them to you." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={<Layers />} title={brand.name}>{ROLE_STATEMENTS.platform}</FeatureCard>
          <FeatureCard icon={<UserRoundCheck />} title="Your broker of record">{ROLE_STATEMENTS.broker}</FeatureCard>
          <FeatureCard icon={<Building2 />} title="The insurer">{ROLE_STATEMENTS.insurer}</FeatureCard>
          <FeatureCard icon={<CreditCard />} title="Payment provider">{ROLE_STATEMENTS.payment}</FeatureCard>
        </div>
        <div className="mt-10 rounded-[20px] border border-line bg-white p-6 shadow-card sm:p-8">
          <h3 className="text-[20px] leading-[1.25] text-ink">The mandatory disclosure</h3>
          <p className="mt-1.5 text-[15px] text-muted">
            Before any advice or application — and on every quote, checkout and policy screen — you see a statement like this, built from the actual broker and insurer for your request:
          </p>
          <DisclosureBlock text={example} className="mt-5" />
          {demo && <DemoBadge className="mt-3" />}
        </div>
      </Section>

      <Section id="licensing" tone="mist" labelledBy="licensing-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <Eyebrow className="mb-3">Licensing status</Eyebrow>
            <h2 id="licensing-title" className="text-[30px] leading-[1.12] md:text-[42px] text-ink">Our regulatory position</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-ink-2">
              {brand.name} is a technology platform — not an insurer and not a broker. We operate as a technology provider in partnership with licensed brokers and insurers. Our regulatory classification is being confirmed with the National Insurance Commission (NIC).
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              Insurance broking services are provided only by brokers licensed by the NIC, and policies are underwritten only by insurers licensed under the {REGULATION.act1061}. We will update this page when our classification is confirmed.
            </p>
          </div>
          <div className="space-y-4">
            <div className="rounded-card border border-line bg-white p-6">
              <div className="flex items-center gap-3">
                <IconTile><Landmark /></IconTile>
                <h3 className="text-[20px] leading-[1.25] text-ink">Check a licence yourself</h3>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">
                Every participating broker and insurer is listed with its NIC licence number. You can verify licensed entities with the regulator.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                <a href={REGULATION.nic.url} target="_blank" rel="noreferrer" className={textLinkClass}>
                  NIC website <ExternalLink aria-hidden className="size-4" /><span className="sr-only">(opens in a new tab)</span>
                </a>
                <Link href="/partners" className={textLinkClass}>Participating partners <ArrowRight aria-hidden className="size-4" /></Link>
              </div>
            </div>
            <Notice tone="info">
              We do not give insurance advice in our own name. Any guidance tools on this site are general information; your broker advises on your circumstances.
            </Notice>
          </div>
        </div>
      </Section>

      <Section id="integrity" labelledBy="integrity-title">
        <SectionHeading id="integrity-title" eyebrow="Comparison integrity" title="Rules we hold ourselves to" description="Our systems enforce these rules; they are reviewed by our comparison integrity committee." />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRITY.map((r) => (
            <li key={r.title} className="rounded-card border border-line bg-white p-6">
              <IconTile size="sm"><Scale /></IconTile>
              <h3 className="mt-4 text-[20px] leading-[1.25] text-ink">{r.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{r.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="data" tone="mist" labelledBy="data-title">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow className="mb-3">Data protection</Eyebrow>
            <h2 id="data-title" className="text-[30px] leading-[1.12] md:text-[42px] text-ink">Your data, handled with care</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-muted">
              We process personal data in line with the {REGULATION.act843}, and we intend to register with the {REGULATION.dpc.name} as required.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              Cookies and analytics load only with your consent (see the banner and our cookie notice). You can withdraw consent or ask for a copy or deletion of your data at any time.
            </p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/legal/privacy" className={textLinkClass}>Privacy notice <ArrowRight aria-hidden className="size-4" /></Link>
              <Link href="/legal/cookies" className={textLinkClass}>Cookie notice <ArrowRight aria-hidden className="size-4" /></Link>
              <a href={REGULATION.dpc.url} target="_blank" rel="noreferrer" className={textLinkClass}>
                Data Protection Commission <ExternalLink aria-hidden className="size-4" /><span className="sr-only">(opens in a new tab)</span>
              </a>
            </div>
          </div>
          <div className="rounded-card border border-line bg-white p-6">
            <div className="flex items-center gap-3">
              <IconTile><LockKeyhole /></IconTile>
              <h3 className="text-[20px] leading-[1.25] text-ink">Our commitments</h3>
            </div>
            <CheckList
              className="mt-5"
              items={[
                "We collect only what is needed to arrange and service your insurance.",
                "We share it only with your broker, the insurers you ask for quotes and the payment provider.",
                "We never sell your personal data.",
                "Access is restricted by role and organisation, and logged in a tamper-evident audit trail.",
                "You can access, correct and ask us to delete your data, subject to legal retention rules.",
              ]}
            />
          </div>
        </div>
      </Section>

      <Section id="complaints" labelledBy="complaints-title">
        <SectionHeading id="complaints-title" eyebrow="Complaints & escalation" title="If something goes wrong" description="Tell us. We route your complaint to the party responsible and keep you updated until it is resolved." />
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            { step: "1", title: "Your broker", body: "For advice, quotes, policies and claims handling. Raise it from your account or with your broker directly. They acknowledge it promptly." },
            { step: "2", title: brand.name, body: `If you are unhappy with the response, or the issue is with our service, contact us at ${brand.supportEmail}. We aim to resolve complaints within 14 days.` },
            { step: "3", title: "National Insurance Commission", body: "If your complaint is still not resolved to your satisfaction, you can escalate it to the NIC Complaints Bureau." },
          ].map((s) => (
            <li key={s.step} className="relative rounded-card border border-line bg-white p-6">
              <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-white">{s.step}</span>
              <h3 className="mt-4 text-[20px] leading-[1.25] text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-col gap-4 rounded-card border border-line bg-mist p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-3 text-[15px] text-ink-2">
            <FileWarning aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
            Claims are decided by the insurer. A complaint about a claim decision is handled by the insurer, with your broker’s help.
          </p>
          <Link href="/legal/complaints" className={`${textLinkClass} shrink-0`}>Complaints procedure <ArrowRight aria-hidden className="size-4" /></Link>
        </div>
        <p className="mt-6 text-[15px] text-muted">
          Contact us: <a href={`mailto:${brand.supportEmail}`} className="font-medium text-brand hover:underline">{brand.supportEmail}</a> · <Link href="/contact" className="font-medium text-brand hover:underline">contact form</Link> · <Link href="/verify" className="font-medium text-brand hover:underline">verify a policy</Link>
        </p>
      </Section>
    </>
  );
}
