import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, Braces, CalendarCheck, Database, FileCheck2, GitBranch, Globe2, KeyRound, LayoutDashboard, PlugZap, TrendingDown, Users, Workflow, Zap } from "lucide-react";
import { Pill, buttonClass } from "@im/ui";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "For insurers",
  description:
    "Distribute approved products through licensed brokers on a controlled digital channel. Start with a partner portal, then connect quote and policy APIs — with governed product data and strong API safeguards.",
  alternates: { canonical: "/insurers" },
};

const BENEFITS = [
  { icon: Users, title: "New customers", body: "Reach people who start on their phone — first-time buyers, SMEs and renewals switching from paper." },
  { icon: Globe2, title: "Diaspora reach", body: "Ghanaians in the UK, US, Europe and Canada paying in their own currency for cover at home." },
  { icon: TrendingDown, title: "Lower acquisition cost", body: "Structured, complete submissions and digital issuance cut the cost of every policy sold." },
  { icon: Zap, title: "Instant digital issuance", body: "Issue certificates to the customer’s wallet in minutes, with QR verification built in." },
  { icon: BarChart3, title: "Data insights", body: "Conversion, pricing position and renewal retention by product — without exposing customer data." },
];

const COMMERCIAL = [
  { title: "Portal (Level 1)", body: "Platform fee: set per partner agreement.", tag: "Agreement" },
  { title: "Connected (Levels 2–3)", body: "Commission and a platform fee set per partner agreement, with a monthly reconciliation feed.", tag: "Usage" },
  { title: "What never changes", body: "Premiums settle to the insurer. Broker commission is set by you and disclosed to the customer. Covva never earns more by steering customers to one insurer.", tag: "Principle" },
];

const ONBOARDING = [
  { title: "Register", body: "Create your insurer account and tell us the classes you want to distribute." },
  { title: "Licence check", body: "We verify your NIC licence and the products you are approved to sell." },
  { title: "Agreement", body: "Heads of terms, data responsibilities and the broker panel agreed and signed." },
  { title: "Products & rates", body: "Upload approved wording, limits, excesses and rating rules; name a data owner." },
  { title: "Pilot & go live", body: "A controlled pilot with real requests, then scale on evidence." },
];

const LEVELS = [
  {
    level: "Level 1",
    icon: LayoutDashboard,
    title: "Partner portal",
    tag: "Start in weeks",
    body: "Receive structured submissions in a secure portal, return quotes, accept risks, upload policies and update claim status. No integration work required.",
    points: ["Submission inbox with complete risk data", "Quote and policy document upload", "Claim acknowledgement and status updates"],
  },
  {
    level: "Level 2",
    icon: PlugZap,
    title: "Quote API",
    tag: "Faster quotes",
    body: "Return binding or indicative quotes automatically from your rating engine through our connector contract.",
    points: ["Common internal risk format", "Estimate vs binding quote states", "Validity dates and revalidation at checkout"],
  },
  {
    level: "Level 3",
    icon: Workflow,
    title: "Full policy API",
    tag: "End-to-end",
    body: "Bind, issue and service policies programmatically, with webhooks and reconciliation feeds for payments and documents.",
    points: ["Issuance and policy numbers from your core system", "Endorsements, renewals and cancellations", "Webhooks and reconciliation feeds"],
  },
];

const SAFEGUARDS = [
  "Scoped API keys per insurer and environment, rotated and revocable",
  "Signed webhooks with replay protection",
  "Idempotency keys on every write",
  "Rate limits and anomaly monitoring",
  "Versioned API contracts with deprecation notice",
  "A submission registry that blocks duplicate submissions of the same risk",
  "Data minimisation: you receive what you need to underwrite, nothing more",
  "Tamper-evident audit trail of every call and status change",
];

const GOVERNANCE = [
  { icon: FileCheck2, title: "Insurer-approved wording", body: "Product summaries, limits, excesses and exclusions are published only after your approval." },
  { icon: GitBranch, title: "Versioned product data", body: "Every change creates a new version with an effective date; past quotes keep the version they used." },
  { icon: KeyRound, title: "Named data owner", body: "Each product has a named owner at your company responsible for its accuracy." },
  { icon: Database, title: "Checked at checkout", body: "Quotes are revalidated against current rates and wording before a customer pays." },
];

export default async function InsurersPage() {

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "For insurers" }]}
        eyebrow="For insurers"
        title={<>Digital distribution, <span className="text-brand">under your control.</span></>}
        lede="Reach customers through licensed brokers on a channel built for clean submissions, comparable product data and clear accountability. Integrate at the pace that suits you."
        actions={
          <>
            <Link href="/partner/register?type=insurer" className={buttonClass("primary", "lg")}>Register as an Insurer <ArrowRight aria-hidden className="size-4" /></Link>
            <Link href="#enquire" className={buttonClass("secondary", "lg")}><CalendarCheck aria-hidden className="size-4" /> Book a meeting</Link>
          </>
        }
      />

      <Section labelledBy="benefits-title">
        <SectionHeading id="benefits-title" eyebrow="Why insurers partner with Covva" title="Grow a digital channel without building one" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {BENEFITS.map((b) => (
            <FeatureCard key={b.title} icon={<b.icon />} title={b.title}>{b.body}</FeatureCard>
          ))}
        </div>
      </Section>

      <Section id="levels" tone="mist" labelledBy="levels-title">
        <SectionHeading id="levels-title" eyebrow="Three integration levels" title="Start simple. Connect deeper when it pays." />
        <div className="grid gap-4 lg:grid-cols-3">
          {LEVELS.map((l) => (
            <article key={l.title} className="flex flex-col rounded-[20px] border border-line bg-white p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <IconTile><l.icon /></IconTile>
                <Pill tone="ok">{l.tag}</Pill>
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-brand">{l.level}</p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight text-ink">{l.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{l.body}</p>
              <CheckList className="mt-6 border-t border-line pt-6" items={l.points} />
            </article>
          ))}
        </div>
      </Section>

      <Section labelledBy="commercial-title">
        <SectionHeading id="commercial-title" eyebrow="Commercial model" title="Simple, transparent, and never tied to steering." />
        <div className="grid gap-4 md:grid-cols-3">
          {COMMERCIAL.map((c) => (
            <div key={c.title} className="rounded-card border border-line bg-white p-6">
              <Pill>{c.tag}</Pill>
              <h3 className="mt-4 text-[20px] leading-[1.25] md:text-[24px] text-ink">{c.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="mist" labelledBy="onboarding-title">
        <SectionHeading id="onboarding-title" eyebrow="Onboarding" title="Five steps to your first policy" />
        <ol className="grid gap-3 md:grid-cols-5">
          {ONBOARDING.map((g, i) => (
            <li key={g.title} className="relative rounded-card border border-line bg-white p-5">
              <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold tabular-nums text-white">{i + 1}</span>
              <h3 className="mt-4 text-[20px] leading-[1.25] md:text-[24px] text-ink">{g.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{g.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/partner/register?type=insurer" className={buttonClass("primary", "md")}>Register as an Insurer <ArrowRight aria-hidden className="size-4" /></Link>
          <Link href="/waitlist#partners" className={buttonClass("outline", "md")}>Become a launch partner</Link>
        </div>
      </Section>

      <Section labelledBy="standard-title">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading id="standard-title" eyebrow="Internal insurance data standard" title="One risk format. Every channel." className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Customers describe their risk once, on web or mobile. We normalise it into a common internal format per category, so you receive consistent, complete submissions whichever channel they came from — and our connector maps it to yours.
            </p>
            <CheckList
              className="mt-8"
              items={[
                "Category schemas with required fields and validation",
                "Documents attached with their type, not just a file name",
                "A risk fingerprint for duplicate detection",
                "Needs assessment and broker notes travel with the request",
              ]}
            />
          </div>
          <div className="self-center overflow-hidden rounded-card border border-line bg-mist p-6 font-mono text-[13px] leading-relaxed text-brand-deep" aria-label="Example of a normalised motor risk record">
            <div className="mb-4 flex items-center gap-2 font-sans text-xs text-muted">
              <Braces aria-hidden className="size-4" /> submission.risk — motor (illustrative)
            </div>
            <pre className="overflow-x-auto whitespace-pre text-ink-2">{`{
  "category": "motor",
  "cover_type": "comprehensive",
  "vehicle": { "make": "Toyota", "model": "Corolla", "year": 2019 },
  "vehicle_value": "<declared value>",
  "use": "private",
  "driver_age": 34,
  "claims_last_3_years": 0,
  "region": "Greater Accra",
  "documents": ["vehicle_registration", "drivers_licence"],
  "broker_of_record": "NIC/DEMO/BRK/001"
}`}</pre>
          </div>
        </div>
      </Section>

      <Section tone="mist" labelledBy="safeguards-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <SectionHeading id="safeguards-title" eyebrow="API safeguards" title="Secure by default" description="Connectors are designed to protect your systems and your customers’ data." className="mb-0! sm:mb-0!" />
          </div>
          <CheckList className="sm:columns-2 sm:gap-8 [&>li]:break-inside-avoid [&>li]:mb-3" items={SAFEGUARDS} />
        </div>
      </Section>

      <Section labelledBy="gov-title">
        <SectionHeading id="gov-title" eyebrow="Product-data governance" title="Your products, described the way you approved them" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GOVERNANCE.map((g) => (
            <div key={g.title} className="rounded-card border border-line bg-white p-6">
              <IconTile><g.icon /></IconTile>
              <h3 className="mt-5 text-[20px] leading-[1.25] md:text-[24px] text-ink">{g.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{g.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="plans" tone="mist" labelledBy="plans-title">
        <SectionHeading id="plans-title" eyebrow="Insurer plans" title="Portal or connected" />
        <p className="text-muted">Platform fee: set per partner agreement, in addition to commission. Neither commission nor fees affect rankings.</p>
      </Section>

      <Section id="enquire" labelledBy="enquire-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="enquire-title" eyebrow="Book a meeting" title="Start a conversation" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Tell us which classes you would like to distribute and how you prefer to integrate. We will arrange a session with our partnerships and technical teams — usually within two working days.
            </p>
            <p className="mt-6 text-sm text-muted">Ready now? <Link href="/partner/register?type=insurer" className="font-medium text-brand hover:underline">Register as an Insurer</Link> and we will pick up the rest in onboarding.</p>
          </div>
          <LeadForm
            kind="insurer"
            organization="required"
            organizationLabel="Insurer"
            messageLabel="What would you like to explore?"
            messagePlaceholder="Classes of business, preferred integration level, timelines."
            submitLabel="Book a meeting"
            successBody="Thank you. Our partnerships team will contact you within two working days to arrange a session."
          />
        </div>
      </Section>
    </>
  );
}
