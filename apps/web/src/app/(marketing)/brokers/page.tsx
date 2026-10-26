import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  ClipboardList,
  FileStack,
  Inbox,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Timer,
  UserRoundCheck,
} from "lucide-react";
import { DemoBadge, buttonClass } from "@im/ui";
import { getPlans } from "@/lib/catalog";
import { isDemoMode } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { BrokerQueueMock } from "@/components/marketing/broker-queue-mock";
import { PlanCards } from "@/components/marketing/plan-cards";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "For brokers",
  description:
    "A new digital distribution channel for licensed brokers in Ghana: structured requests, a workspace that drives fulfilment, clear SLAs, traceable records and renewals — with your firm as broker of record.",
  alternates: { canonical: "/brokers" },
};

const VALUE = [
  { icon: Megaphone, title: "A new distribution channel", body: "Reach customers who start online and on mobile, without building and running your own digital platform." },
  { icon: ClipboardList, title: "Structured requests", body: "Every request arrives with the risk details, documents and needs assessment your advisers would otherwise chase." },
  { icon: LayoutDashboard, title: "A workspace that drives fulfilment", body: "Quotes, insurer submissions, payments and policy delivery move through one controlled sequence." },
  { icon: UserRoundCheck, title: "One accountable broker", body: "Your firm is the named broker of record for each request, disclosed to the customer before any advice." },
  { icon: Timer, title: "A queue with SLAs", body: "Response targets, at-risk flags and escalation to named supervisors keep every request moving." },
  { icon: ScrollText, title: "Traceable records", body: "Disclosures, advice, consents and status changes are written to a tamper-evident audit trail." },
  { icon: BellRing, title: "Renewals built in", body: "Automatic reminders and renewal reviews protect your book and keep customers properly covered." },
];

const GATES = [
  { title: "Licence and fit", body: "We verify your NIC licence, professional indemnity cover and the classes you are approved to place." },
  { title: "Heads of terms", body: "Commercial terms, roles and data responsibilities agreed and documented before any build-out." },
  { title: "Operating procedures", body: "Routing rules, SLAs, complaint handling and claims assistance procedures written and tested." },
  { title: "Controlled pilot", body: "A limited pilot with real requests, agreed categories and weekly service reviews." },
  { title: "Evidence-based scale-up", body: "We extend categories and volume only when pilot evidence — service levels, complaints, conversion — supports it." },
];

export default async function BrokersPage() {
  const [plans, demo] = await Promise.all([getPlans(), isDemoMode()]);
  const brokerPlans = plans.filter((p) => p.audience === "broker");

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "For brokers" }]}
        eyebrow="For brokers"
        title={<>More customers. <span className="text-brand">Less chasing.</span></>}
        lede="Covva gives licensed brokers a digital front door and a workspace built around the request — so your advisers spend their time advising, not collecting information."
        actions={
          <>
            <Link href="#enquire" className={buttonClass("primary", "lg")}>Become a partner broker</Link>
            <Link href="#plans" className={buttonClass("secondary", "lg")}>See plans</Link>
          </>
        }
      />

      <Section labelledBy="value-title">
        <SectionHeading id="value-title" eyebrow="Why partner with us" title="Built for how brokers actually work" description="You stay the regulated adviser. We provide the technology, the customer experience and the operational backbone." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE.map((v) => (
            <FeatureCard key={v.title} icon={<v.icon />} title={v.title}>{v.body}</FeatureCard>
          ))}
          <div className="flex flex-col justify-between rounded-card bg-brand-deep p-6 text-white">
            <Inbox aria-hidden className="size-6 text-mint" />
            <p className="mt-6 text-[17px] font-semibold leading-snug">“One queue for mobile and web. Clear ownership at every step.”</p>
          </div>
        </div>
      </Section>

      <Section tone="mist" labelledBy="workspace-title" className="overflow-hidden">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div>
            <SectionHeading id="workspace-title" eyebrow="The partner workspace" title="Your request queue, at a glance" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              New requests, missing documents and response targets at risk are visible the moment you sign in. Each request shows what it is waiting on and who owns the next step.
            </p>
            <CheckList
              className="mt-8"
              items={[
                "Buckets for customer information, adviser action, insurer response, payment and documents.",
                "Fulfilment checkpoints: confirm choice → verify payment → insurer issue → deliver documents.",
                "Threaded messaging with documents in context, on web and mobile.",
                "No policy shows as active until the insurer confirms issuance.",
              ]}
            />
          </div>
          <div>
            <BrokerQueueMock />
            <p className="sr-only">Illustration of the partner workspace request queue with counts of new requests, requests awaiting documents and response targets at risk, and a list of requests with status, owner and next response time.</p>
            {demo && <DemoBadge className="mt-3" />}
          </div>
        </div>
      </Section>

      <Section id="plans" labelledBy="plans-title">
        <SectionHeading id="plans-title" eyebrow="Plans" title="Start with a pilot. Grow on evidence." description="Simple workspace plans for broker firms. You keep your commission; our fees are for the technology." />
        <PlanCards plans={brokerPlans} />
      </Section>

      <Section tone="mist" labelledBy="gates-title">
        <SectionHeading id="gates-title" eyebrow="Partnership process" title="Five evidence-based gates" description="We move together, one gate at a time. Nothing goes live with customers until the gate before it is passed." />
        <ol className="grid gap-3 md:grid-cols-5">
          {GATES.map((g, i) => (
            <li key={g.title} className="relative rounded-card border border-line bg-white p-5">
              <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-white tabular-nums">{i + 1}</span>
              <h3 className="mt-4 font-semibold tracking-tight text-ink">{g.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{g.body}</p>
              {i < GATES.length - 1 && <ArrowRight aria-hidden className="absolute -right-3 top-8 z-10 hidden size-5 rounded-full bg-mist text-subtle md:block" />}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="enquire" labelledBy="enquire-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="enquire-title" eyebrow="Partner enquiry" title="Let’s talk" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Tell us about your firm and the classes you place. We will come back within two working days to arrange an introductory conversation.
            </p>
            <div className="mt-8 rounded-card border border-line bg-mist p-5 text-sm leading-relaxed text-ink-2">
              <FileStack aria-hidden className="mb-3 size-5 text-brand" />
              Helpful to have ready: your NIC licence number, classes of business, number of advisers, and the insurers you are appointed with.
            </div>
          </div>
          <LeadForm
            kind="broker"
            organization="required"
            organizationLabel="Broker firm"
            messageLabel="Tell us about your firm"
            messagePlaceholder="Licence number, classes you place, team size, and what you would like to achieve."
            submitLabel="Send enquiry"
            successBody="Thank you. Our partnerships team will be in touch within two working days to arrange an introductory conversation."
          />
        </div>
      </Section>
    </>
  );
}
