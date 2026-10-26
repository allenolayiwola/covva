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
  MessageCircle,
  Percent,
  PhoneCall,
  ScrollText,
  Timer,
  UserRoundCheck,
  Wallet,
} from "lucide-react";
import { DemoBadge, Pill, buttonClass } from "@im/ui";
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
  { icon: Megaphone, title: "Free qualified leads", body: "Customers who have already described their risk and uploaded documents, routed to your firm — no cost per lead." },
  { icon: Wallet, title: "Faster payment", body: "Premiums collected by MoMo or card settle to the insurer; your commission statement follows automatically." },
  { icon: BellRing, title: "Renewals on autopilot", body: "Automatic reminders and renewal reviews protect your book and keep customers properly covered." },
  { icon: LayoutDashboard, title: "A free digital office", body: "Quotes, insurer submissions, payments, policy delivery and claims in one workspace — nothing to install." },
  { icon: MessageCircle, title: "Works on WhatsApp and mobile", body: "Message customers in the request thread, from the app or WhatsApp-assisted service as it is approved." },
  { icon: ClipboardList, title: "Structured requests", body: "Every request arrives with the risk details, documents and needs assessment your advisers would otherwise chase." },
  { icon: LayoutDashboard, title: "A workspace that drives fulfilment", body: "Quotes, insurer submissions, payments and policy delivery move through one controlled sequence." },
  { icon: UserRoundCheck, title: "One accountable broker", body: "Your firm is the named broker of record for each request, disclosed to the customer before any advice." },
  { icon: Timer, title: "A queue with SLAs", body: "Response targets, at-risk flags and escalation to named supervisors keep every request moving." },
  { icon: ScrollText, title: "Traceable records", body: "Disclosures, advice, consents and status changes are written to a tamper-evident audit trail." },
];

const MODELS = [
  { icon: Percent, title: "Revenue share", tag: "No fixed fee", body: "Keep your commission; Covva takes an agreed technology share on policies issued through the platform. Best when you are starting out." },
  { icon: LayoutDashboard, title: "Subscription", tag: "Predictable", body: "A flat monthly workspace fee per firm with no per-policy share. Best for established firms with steady volume." },
];

const ONBOARDING = [
  { title: "Register", body: "Create your firm’s account in minutes." },
  { title: "Licence check", body: "We verify your NIC licence, PI cover and classes." },
  { title: "Agreement", body: "Commercial model, SLAs and data roles signed." },
  { title: "Set up", body: "Add advisers, insurer appointments and routing rules." },
  { title: "Pilot & scale", body: "Real requests, weekly reviews, then more categories." },
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
            <Link href="/partner/register?type=broker" className={buttonClass("primary", "lg")}>Register as a Broker <ArrowRight aria-hidden className="size-4" /></Link>
            <Link href="#enquire" className={buttonClass("secondary", "lg")}><PhoneCall aria-hidden className="size-4" /> Request a call</Link>
          </>
        }
      />

      <Section labelledBy="value-title">
        <SectionHeading id="value-title" eyebrow="Why partner with us" title="Built for how brokers actually work" description="You stay the regulated adviser. We provide the technology, the customer experience and the operational backbone." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE.map((v) => (
            <FeatureCard key={v.title} icon={<v.icon />} title={v.title}>{v.body}</FeatureCard>
          ))}
          <div className="flex flex-col justify-between rounded-card border border-line bg-mint/60 p-6 text-ink">
            <Inbox aria-hidden className="size-6 text-brand" />
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

      <Section labelledBy="models-title">
        <SectionHeading id="models-title" eyebrow="Commercial models" title="Revenue share or subscription — your choice" description="You keep your commission either way; our fees are for the technology, and are disclosed to customers." />
        <div className="grid gap-4 md:grid-cols-2">
          {MODELS.map((m) => (
            <article key={m.title} className="rounded-[20px] border border-line bg-white p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <span aria-hidden className="inline-grid size-11 place-items-center rounded-xl bg-mint text-brand-deep"><m.icon className="size-5" /></span>
                <Pill tone="ok">{m.tag}</Pill>
              </div>
              <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">{m.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{m.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="plans" tone="mist" labelledBy="plans-title">
        <SectionHeading id="plans-title" eyebrow="Plans" title="Start with a pilot. Grow on evidence." description="Simple workspace plans for broker firms. You keep your commission; our fees are for the technology." />
        <PlanCards plans={brokerPlans} />
      </Section>

      <Section labelledBy="onboarding-title">
        <SectionHeading id="onboarding-title" eyebrow="Onboarding" title="From registration to first request" />
        <ol className="grid gap-3 md:grid-cols-5">
          {ONBOARDING.map((g, i) => (
            <li key={g.title} className="relative rounded-card border border-line bg-white p-5">
              <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold tabular-nums text-white">{i + 1}</span>
              <h3 className="mt-4 font-semibold tracking-tight text-ink">{g.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{g.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/partner/register?type=broker" className={buttonClass("primary", "md")}>Register as a Broker <ArrowRight aria-hidden className="size-4" /></Link>
          <Link href="/waitlist#partners" className={buttonClass("outline", "md")}>Become a launch partner</Link>
        </div>
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
            <SectionHeading id="enquire-title" eyebrow="Request a call" title="Let’s talk" className="mb-6! sm:mb-6!" />
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
            submitLabel="Request a call"
            successBody="Thank you. Our partnerships team will call you within two working days to arrange an introductory conversation."
          />
        </div>
      </Section>
    </>
  );
}
