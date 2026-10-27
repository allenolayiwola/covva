import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Camera,
  ClipboardCheck,
  FileCheck2,
  FileSearch,
  FileText,
  Handshake,
  ListChecks,
  LockKeyhole,
  MessageCircle,
  Scale,
  Send,
  ShieldAlert,
  UserRoundCheck,
  Wallet,
} from "lucide-react";
import { Eyebrow, Pill, buttonClass } from "@im/ui";
import { QUOTE_STATUS } from "@im/core";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { CtaBand } from "@/components/marketing/cta-band";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Compare and buy, get help choosing, or get help with a claim. See every step, who is responsible for it, and why payment alone never makes a policy active.",
  alternates: { canonical: "/how-it-works" },
};

type Step = { icon: React.ComponentType<{ className?: string }>; title: string; body: string; who: string };

const JOURNEYS: { id: string; letter: string; title: string; summary: string; steps: Step[] }[] = [
  {
    id: "compare",
    letter: "A",
    title: "Compare and buy",
    summary: "You know the cover you want. Tell us about the risk once and compare quotes from participating insurers.",
    steps: [
      { icon: ListChecks, title: "Tell us about the risk", body: "Answer the questions for your category — your vehicle, trip or home. Your progress is saved as you go.", who: "You" },
      { icon: UserRoundCheck, title: "Meet your broker", body: "We name your broker of record, with their NIC licence number, before any advice or application.", who: "Broker" },
      { icon: Scale, title: "Compare quotes", body: "See premium, cover, limits, excesses and exclusions side by side, with each quote’s state and validity.", who: "You + broker" },
      { icon: ClipboardCheck, title: "Apply", body: "Confirm your declarations for the quote you choose. Only quotes marked “Ready to accept” can be applied for.", who: "You" },
      { icon: Banknote, title: "Pay the insurer", body: "Pay by mobile money or card through an authorised payment provider, directly to the insurer.", who: "Payment provider" },
      { icon: FileCheck2, title: "Insurer issues your policy", body: "The insurer confirms acceptance and issues your policy. Only then does your cover show as active.", who: "Insurer" },
      { icon: Wallet, title: "Documents in your wallet", body: "Your schedule, certificate and wording are delivered to your cover wallet.", who: "Broker" },
    ],
  },
  {
    id: "choose",
    letter: "B",
    title: "Help me choose",
    summary: "You are not sure what you need. We help you identify the right categories first — not merely the cheapest product.",
    steps: [
      { icon: ListChecks, title: "Answer a few questions", body: "About your household, work, what you own and your budget. No sign-in needed.", who: "You" },
      { icon: FileSearch, title: "See suggestions and reasons", body: "We suggest categories by priority and explain why each one matters for you.", who: "Platform" },
      { icon: UserRoundCheck, title: "Adviser review where needed", body: "Business, specialist or several needs at once are reviewed by an adviser before insurers are approached.", who: "Broker" },
      { icon: Scale, title: "Continue to quotes", body: "Start a request for any suggestion and follow journey A from there.", who: "You + broker" },
    ],
  },
  {
    id: "claim",
    letter: "C",
    title: "Claim assistance",
    summary: "Something has happened. Your broker helps you report it properly, and you can see every step the insurer takes.",
    steps: [
      { icon: Camera, title: "Report from your wallet", body: "Tell us what happened and add photos and documents from your phone.", who: "You" },
      { icon: MessageCircle, title: "Your broker checks it", body: "They help you complete the claim and request anything the insurer is likely to need.", who: "Broker" },
      { icon: Send, title: "Delivered to the insurer", body: "We show when the insurer has actually received your claim — uploading is not the same as delivery.", who: "Broker + insurer" },
      { icon: FileSearch, title: "Assessment", body: "The insurer acknowledges, may ask for more information and assesses the claim under your policy terms.", who: "Insurer" },
      { icon: BadgeCheck, title: "Decision and payment", body: "Only the insurer approves, declines or pays a claim. Reporting a claim never means it is approved.", who: "Insurer" },
    ],
  },
];

const SEQUENCE = [
  "Request created",
  "Broker disclosed",
  "Quotes prepared",
  "Quote accepted",
  "Payment confirmed",
  "Insurer issues policy",
  "Documents delivered",
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        breadcrumb={[{ label: "How it works" }]}
        eyebrow="How it works"
        title={<>Every step visible. <span className="text-brand">Every role clear.</span></>}
        lede="Three ways to use the marketplace, one controlled sequence behind every policy, and a named broker accountable for your request throughout."
        actions={
          <>
            <Link href="/get-started" className={buttonClass("primary", "lg")}>What do I need?</Link>
            <Link href="/explore" className={buttonClass("secondary", "lg")}>Explore cover</Link>
          </>
        }
      >
        <nav aria-label="Journeys" className="mt-10 flex flex-wrap gap-2">
          {JOURNEYS.map((j) => (
            <a key={j.id} href={`#${j.id}`} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-2 hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <span className="grid size-5 place-items-center rounded-full bg-mint text-[13px] font-bold text-brand-deep">{j.letter}</span>
              {j.title}
            </a>
          ))}
          <a href="#sequence" className="inline-flex items-center rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-2 hover:border-brand hover:text-brand">The transaction sequence</a>
          <a href="#data" className="inline-flex items-center rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-2 hover:border-brand hover:text-brand">Your data</a>
        </nav>
      </PageHero>

      {JOURNEYS.map((j, idx) => (
        <Section key={j.id} id={j.id} tone={idx % 2 === 1 ? "mist" : "white"} labelledBy={`${j.id}-title`}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand text-xl font-bold text-white">{j.letter}</span>
              <Eyebrow className="mt-6">Journey {j.letter}</Eyebrow>
              <h2 id={`${j.id}-title`} className="mt-2 text-[30px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[38px]">{j.title}</h2>
              <p className="mt-4 text-[17px] leading-relaxed text-muted">{j.summary}</p>
              {j.id === "choose" && (
                <Link href="/get-started" className={`${textLinkClass} mt-6`}>Try Help me choose <ArrowRight aria-hidden className="size-4" /></Link>
              )}
              {j.id === "compare" && (
                <Link href="/explore" className={`${textLinkClass} mt-6`}>Choose a category <ArrowRight aria-hidden className="size-4" /></Link>
              )}
            </div>
            <ol className="relative space-y-3">
              {j.steps.map((s, i) => (
                <li key={s.title} className="relative flex gap-4 rounded-card border border-line bg-white p-5 sm:p-6">
                  <IconTile><s.icon /></IconTile>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="font-semibold text-ink">
                        <span className="mr-2 text-sm tabular-nums text-subtle">{i + 1}.</span>
                        {s.title}
                      </h3>
                      <Pill className="ml-auto">{s.who}</Pill>
                    </div>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Section>
      ))}

      {/* Controlled sequence */}
      <Section id="sequence" tone="brand" labelledBy="sequence-title">
        <SectionHeading
          id="sequence-title"
          invert
          eyebrow="The controlled transaction sequence"
          title="The same safeguards behind every policy"
          description="Each step must be completed, in order, by the party responsible for it. Our systems enforce this — it is not just a promise."
        />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {SEQUENCE.map((s, i) => (
            <li key={s} className="relative rounded-card border border-line bg-white p-4">
              <span className="text-xs font-semibold tabular-nums text-brand">Step {i + 1}</span>
              <p className="mt-1.5 text-[15px] font-semibold leading-snug text-ink">{s}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div className="flex gap-4 rounded-card border border-line bg-white p-6 text-ink">
            <IconTile tone="amber"><ShieldAlert /></IconTile>
            <div>
              <p className="text-lg font-semibold tracking-tight">Payment confirmation alone never marks a policy active.</p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                After you pay, your request shows “Awaiting insurer issuance”. Your cover starts only when the insurer confirms acceptance and issues a policy number.
              </p>
            </div>
          </div>
          <CheckList
            invert
            className="self-center"
            items={[
              "One broker of record per request, named before advice or application.",
              "The same risk is never submitted twice to the same insurer.",
              "Quotes are checked again at checkout; expired quotes cannot be paid.",
              "Premiums settle to the insurer — we never hold your money.",
            ]}
          />
        </div>
      </Section>

      {/* Quote states */}
      <Section labelledBy="states-title">
        <SectionHeading
          id="states-title"
          eyebrow="Quote states"
          title="Know exactly what kind of price you are looking at"
          description="Every quote carries one of three states, a time-stamp and, when binding, a validity date."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {(["estimate", "awaiting_underwriting", "ready_to_accept"] as const).map((k) => (
            <div key={k} className="rounded-card border border-line bg-white p-6">
              <Pill tone={QUOTE_STATUS[k].tone}>{QUOTE_STATUS[k].label}</Pill>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{QUOTE_STATUS[k].customerHint}</p>
              <p className="mt-3 text-sm text-muted">
                {k === "estimate" && "Useful for budgeting. You cannot apply for an estimate."}
                {k === "awaiting_underwriting" && "Your broker tells you when to expect a decision."}
                {k === "ready_to_accept" && "Revalidated at checkout. After the validity date it expires and a new quote is needed."}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Data */}
      <Section id="data" tone="mist" labelledBy="data-title">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow className="mb-3">What happens to your data</Eyebrow>
            <h2 id="data-title" className="text-[30px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[38px]">Shared only with the people arranging your cover</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">
              We process personal data under Ghana’s Data Protection Act, 2012 (Act 843). You can see, correct and ask us to delete your information.
            </p>
            <Link href="/legal/privacy" className={`${textLinkClass} mt-6`}>Read the privacy notice <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: Handshake, title: "Your broker", body: "Sees your request, documents and messages to advise and arrange cover." },
              { icon: FileText, title: "Insurers you ask", body: "Receive only the information needed to quote and underwrite your risk." },
              { icon: Banknote, title: "Payment provider", body: "Processes your payment. We never see or store full card details." },
              { icon: LockKeyhole, title: "Nobody else", body: "We do not sell your data. Access is logged in a tamper-evident audit trail." },
            ].map((d) => (
              <div key={d.title} className="rounded-card border border-line bg-white p-5">
                <IconTile size="sm"><d.icon /></IconTile>
                <p className="mt-3 font-semibold text-ink">{d.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <div className="pt-16 sm:pt-24">
        <CtaBand />
      </div>
    </>
  );
}
