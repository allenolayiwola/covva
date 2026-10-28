import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Braces, Building2, Car, CodeXml, KeyRound, Landmark, LayoutTemplate, Plane, Truck, Webhook } from "lucide-react";
import { Pill, buttonClass } from "@im/ui";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { LeadForm } from "@/components/marketing/lead-form";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "Embedded insurance partners",
  description: "Offer insurance inside your own journey: car dealers, banks and lenders, landlords and property managers, fleets and travel agents. Widget or API, licensed broker of record, instant issuance. Enquire today.",
  alternates: { canonical: "/partners/embedded" },
};

const AUDIENCES = [
  { icon: Car, title: "Car dealers", body: "Comprehensive cover quoted at the point of sale, issued before the buyer drives off. Lenders get the certificate automatically." },
  { icon: Landmark, title: "Banks and lenders", body: "Insurance as a condition of finance — motor, property and credit life — embedded in loan onboarding, with renewal tracking." },
  { icon: Building2, title: "Landlords and property managers", body: "Tenant contents cover and buildings policies for every unit, with QR verification for your records." },
  { icon: Truck, title: "Fleets and ride-hailing", body: "Enrol vehicles and drivers in bulk, keep every certificate valid and get alerts before anything lapses." },
  { icon: Plane, title: "Travel agents", body: "Schengen-compliant travel cover added to any booking, certificate delivered with the itinerary." },
];

const OPTIONS = [
  {
    icon: LayoutTemplate,
    title: "Widget",
    tag: "Go live in days",
    body: "Drop a Covva quote widget into your website or app with one script tag. We handle quotes, payment, issuance and documents under a licensed broker of record.",
    points: ["Pre-fill customer and asset details", "Your branding, our compliance", "Commission or referral fee per policy"],
  },
  {
    icon: CodeXml,
    title: "API",
    tag: "Deep integration",
    body: "Quote, bind and issue inside your own journey with REST APIs, webhooks for status changes and a sandbox to build against.",
    points: ["Scoped API keys per environment", "Signed webhooks with replay protection", "OpenAPI spec and reference client"],
  },
];

export default function EmbeddedPartnersPage() {
  const topics = [
    { value: "dealer", label: "Car dealer" },
    { value: "bank", label: "Bank or lender" },
    { value: "landlord", label: "Landlord or property manager" },
    { value: "fleet", label: "Fleet or ride-hailing" },
    { value: "travel-agent", label: "Travel agent" },
    { value: "other", label: "Other" },
  ];

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Partners", href: "/partners" }, { label: "Embedded partners" }]}
        eyebrow="Embedded insurance"
        title={<>Insurance inside <span className="text-brand">your journey.</span></>}
        lede="Dealers, banks, landlords, fleets and travel agents can offer licensed cover at the moment customers need it — with a widget or an API, and a licensed broker of record behind every policy."
        actions={
          <>
            <a href="#enquire" className={buttonClass("primary", "lg")}>Enquire about embedding</a>
            <a href="#options" className={buttonClass("secondary", "lg")}>Widget vs API</a>
          </>
        }
      />

      <Section labelledBy="aud-title">
        <SectionHeading id="aud-title" eyebrow="Who embeds Covva" title="Built for the moment the customer needs cover" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((a) => (
            <li key={a.title}><FeatureCard icon={<a.icon />} title={a.title} className="h-full">{a.body}</FeatureCard></li>
          ))}
          <li className="flex flex-col justify-between rounded-card border border-line bg-mint/60 p-6 text-ink">
            <KeyRound aria-hidden className="size-6 text-brand" />
            <p className="mt-6 text-[16px] font-semibold leading-snug">Every embedded policy is arranged by a licensed broker and issued by a licensed insurer. Your customers see that disclosure before they pay.</p>
          </li>
        </ul>
      </Section>

      <Section id="options" tone="mist" labelledBy="opt-title">
        <SectionHeading id="opt-title" eyebrow="Two ways to integrate" title="Widget or API — explained simply" />
        <div className="grid gap-4 lg:grid-cols-2">
          {OPTIONS.map((o) => (
            <article key={o.title} className="flex flex-col rounded-[20px] border border-line bg-white p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <IconTile><o.icon /></IconTile>
                <Pill tone="ok">{o.tag}</Pill>
              </div>
              <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">{o.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{o.body}</p>
              <CheckList className="mt-6 border-t border-line pt-6" items={o.points} />
            </article>
          ))}
        </div>
        <div className="mt-6 overflow-hidden rounded-card border border-line bg-mist p-6 font-mono text-[13px] leading-relaxed text-brand-deep" aria-label="Example API call for an embedded motor quote">
          <div className="mb-4 flex items-center gap-2 font-sans text-xs text-muted"><Braces aria-hidden className="size-4" /> POST /api/v1/partner/quotes — illustrative</div>
          <pre className="overflow-x-auto whitespace-pre text-ink-2">{`{
  "category": "motor",
  "cover_type": "comprehensive",
  "vehicle": { "registration": "GX 1234-24", "value": 120000 },
  "customer": { "phone": "+233 24 123 4567", "consent": true },
  "callback_url": "https://dealer.example/webhooks/covva"
}`}</pre>
        </div>
      </Section>

      <Section labelledBy="how-e-title">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading id="how-e-title" eyebrow="What you get" title="Commercial model and support" className="mb-6! sm:mb-6!" />
            <CheckList items={["Referral fee or commission share per policy, paid monthly with a statement", "Dashboard of policies sold through your channel, renewals and lapses", "Webhooks for issued, renewed, cancelled and claim events", "Co-branded documents and verification QR codes", "A named partnerships manager and a technical contact"]} />
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/verify" className={textLinkClass}>Policy verification <ArrowRight aria-hidden className="size-4" /></Link>
              <Link href="/insurers" className={textLinkClass}>For insurers <ArrowRight aria-hidden className="size-4" /></Link>
            </div>
          </div>
          <ol className="space-y-3">
            {[
              { t: "Enquiry and fit", b: "Tell us your use case and volumes. We confirm the broker of record and the insurers for your classes." },
              { t: "Agreement", b: "Commercial terms, data responsibilities and branding agreed in a short partner agreement." },
              { t: "Build", b: "Widget: add the script and map your fields. API: sandbox keys, OpenAPI spec and test policies." },
              { t: "Go live", b: "Pilot with real customers, weekly reviews, then scale." },
            ].map((s, i) => (
              <li key={s.t} className="flex gap-4 rounded-card border border-line bg-white p-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold tabular-nums text-white">{i + 1}</span>
                <div>
                  <p className="font-semibold text-ink">{s.t}</p>
                  <p className="mt-0.5 text-[14.5px] leading-relaxed text-muted">{s.b}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section id="enquire" tone="mist" labelledBy="enquire-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="enquire-title" eyebrow="Embedded partner enquiry" title="Tell us about your channel" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">Where would insurance fit in your customer journey, and roughly how many customers a month? Our partnerships team replies within two working days.</p>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Webhook aria-hidden className="size-4 text-brand" /> Developers: ask for sandbox access in the message.</p>
          </div>
          <LeadForm
            kind="enterprise"
            tag="embedded"
            organization="required"
            organizationLabel="Company"
            topicLabel="Type of business"
            topics={topics}
            messageLabel="Your use case"
            messagePlaceholder="Where insurance fits in your journey, monthly volumes, and whether you prefer a widget or an API."
            submitLabel="Send enquiry"
            successBody="Thank you. Our partnerships team will contact you within two working days."
          />
        </div>
      </Section>
    </>
  );
}
