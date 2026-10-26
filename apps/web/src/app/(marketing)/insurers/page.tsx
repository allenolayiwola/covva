import type { Metadata } from "next";
import Link from "next/link";
import { Braces, Database, FileCheck2, GitBranch, KeyRound, LayoutDashboard, PlugZap, Workflow } from "lucide-react";
import { Pill, buttonClass } from "@im/ui";
import { getPlans } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { PlanCards } from "@/components/marketing/plan-cards";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "For insurers",
  description:
    "Distribute approved products through licensed brokers on a controlled digital channel. Start with a partner portal, then connect quote and policy APIs — with governed product data and strong API safeguards.",
  alternates: { canonical: "/insurers" },
};

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
  const plans = (await getPlans()).filter((p) => p.audience === "insurer");

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "For insurers" }]}
        eyebrow="For insurers"
        title={<>Digital distribution, <span className="text-brand">under your control.</span></>}
        lede="Reach customers through licensed brokers on a channel built for clean submissions, comparable product data and clear accountability. Integrate at the pace that suits you."
        actions={
          <>
            <Link href="#enquire" className={buttonClass("primary", "lg")}>Talk to partnerships</Link>
            <Link href="#levels" className={buttonClass("secondary", "lg")}>Integration levels</Link>
          </>
        }
      />

      <Section id="levels" labelledBy="levels-title">
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

      <Section tone="mist" labelledBy="standard-title">
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
          <div className="self-center overflow-hidden rounded-[20px] border border-line bg-ink p-6 font-mono text-[13px] leading-relaxed text-mint shadow-float" aria-label="Example of a normalised motor risk record">
            <div className="mb-4 flex items-center gap-2 font-sans text-xs text-white/60">
              <Braces aria-hidden className="size-4" /> submission.risk — motor (illustrative)
            </div>
            <pre className="overflow-x-auto whitespace-pre text-white/90">{`{
  "category": "motor",
  "cover_type": "comprehensive",
  "vehicle": { "make": "Toyota", "model": "Corolla", "year": 2019 },
  "vehicle_value": 120000,
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

      <Section labelledBy="safeguards-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <SectionHeading id="safeguards-title" eyebrow="API safeguards" title="Secure by default" description="Connectors are designed to protect your systems and your customers’ data." className="mb-0! sm:mb-0!" />
          </div>
          <CheckList className="sm:columns-2 sm:gap-8 [&>li]:break-inside-avoid [&>li]:mb-3" items={SAFEGUARDS} />
        </div>
      </Section>

      <Section tone="mist" labelledBy="gov-title">
        <SectionHeading id="gov-title" eyebrow="Product-data governance" title="Your products, described the way you approved them" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GOVERNANCE.map((g) => (
            <div key={g.title} className="rounded-card border border-line bg-white p-6">
              <IconTile><g.icon /></IconTile>
              <h3 className="mt-5 font-semibold tracking-tight text-ink">{g.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{g.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="plans" labelledBy="plans-title">
        <SectionHeading id="plans-title" eyebrow="Insurer plans" title="Portal or connected" />
        <PlanCards plans={plans} highlightIndex={-1} />
      </Section>

      <Section id="enquire" tone="mist" labelledBy="enquire-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="enquire-title" eyebrow="Insurer enquiry" title="Start a conversation" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Tell us which classes you would like to distribute and how you prefer to integrate. We will arrange a session with our partnerships and technical teams.
            </p>
          </div>
          <LeadForm
            kind="insurer"
            organization="required"
            organizationLabel="Insurer"
            messageLabel="What would you like to explore?"
            messagePlaceholder="Classes of business, preferred integration level, timelines."
            submitLabel="Send enquiry"
            successBody="Thank you. Our partnerships team will contact you within two working days."
          />
        </div>
      </Section>
    </>
  );
}
