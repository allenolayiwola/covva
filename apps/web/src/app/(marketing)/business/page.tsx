import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Building2, ClipboardCheck, FileStack, Handshake, HeartPulse, LayoutDashboard, Shield, Truck, Upload, Users } from "lucide-react";
import { buttonClass } from "@im/ui";
import { getCategories, getPlans } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { CategoryCard } from "@/components/marketing/category-card";
import { PlanCards } from "@/components/marketing/plan-cards";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "For business",
  description:
    "Property, stock, liability and cargo insurance for Ghanaian SMEs and enterprises — reviewed by a business adviser before insurers are approached. Employer and affinity programmes too.",
  alternates: { canonical: "/business" },
};

export default async function BusinessPage() {
  const [categories, plans] = await Promise.all([getCategories(), getPlans()]);
  const business = categories.filter((c) => c.segment !== "personal");
  const enterprisePlans = plans.filter((p) => p.audience === "enterprise");
  const topics = [
    { value: "group-health-life", label: "Staff group health & life" },
    { value: "fleet-motor", label: "Fleet motor" },
    ...business.map((c) => ({ value: c.slug, label: c.name })),
    { value: "employee-benefits", label: "Employer or affinity programme" },
    { value: "other", label: "Something else" },
  ];

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "For business" }]}
        eyebrow="SME & enterprise"
        title={<>Business cover, <span className="text-brand">properly advised.</span></>}
        lede="Business risks are rarely one-size-fits-all. Every business request is reviewed by a licensed business adviser before insurers are approached — so the quotes you compare fit what you actually do."
        actions={
          <>
            <Link href="#enquire" className={buttonClass("primary", "lg")}>Talk to our team</Link>
            <Link href="#lines" className={buttonClass("secondary", "lg")}>What we cover</Link>
          </>
        }
      />

      <Section id="lines" labelledBy="lines-title">
        <SectionHeading id="lines-title" eyebrow="For SMEs and enterprises" title="Cover for the people, the premises and the fleet" description="One business account, one adviser, every policy in a central dashboard." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={<HeartPulse />} title="Staff group health & life">Private health plans and group life or funeral cover for employees, from 5 staff. Each employee gets a digital membership card.</FeatureCard>
          <FeatureCard icon={<Truck />} title="Fleet motor">Comprehensive or third-party cover for every vehicle on one policy, with certificates per vehicle and lapse alerts.</FeatureCard>
          <FeatureCard icon={<Shield />} title="Property & liability">Premises, stock and equipment, business interruption, public and professional liability, goods in transit.</FeatureCard>
          <FeatureCard icon={<LayoutDashboard />} title="Central dashboard">Every policy, renewal date, certificate and claim for the business in one place, with roles for finance and HR.</FeatureCard>
        </div>
        <div className="mt-6 flex flex-col gap-4 rounded-card border border-line bg-mist p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-3 text-[15px] text-ink-2">
            <Upload aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
            <span><span className="font-semibold text-ink">Bulk enrolment. </span>Upload a spreadsheet of staff or vehicles, or invite employees by link. Changes mid-year — joiners, leavers, new vehicles — take minutes.</span>
          </p>
          <Link href="#enquire" className={buttonClass("primary", "md", "shrink-0")}>Talk to our team</Link>
        </div>
      </Section>

      <Section id="categories" tone="mist" labelledBy="biz-cat-title">
        <SectionHeading id="biz-cat-title" eyebrow="Business categories" title="Cover for traders, SMEs and professionals" description="Availability depends on approved insurer arrangements. Specialist cover is arranged by specialist brokers." />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {business.map((c) => (
            <li key={c.id}><CategoryCard category={c} /></li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="adviser-title">
        <SectionHeading id="adviser-title" eyebrow="Adviser-assisted quotations" title="How a business request works" />
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<ClipboardCheck />} title="1. Tell us about the business">
            Premises, stock, equipment, turnover and staff. Upload photos and documents from your phone; save and finish later.
          </FeatureCard>
          <FeatureCard icon={<BadgeCheck />} title="2. Adviser review">
            A named business adviser checks the risk, asks the right follow-up questions and agrees which insurers to approach.
          </FeatureCard>
          <FeatureCard icon={<FileStack />} title="3. Compare and decide">
            Compare quotes on limits, excesses, conditions and exclusions — with your adviser explaining the trade-offs.
          </FeatureCard>
        </div>
      </Section>

      <Section tone="mist" labelledBy="programmes-title">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading id="programmes-title" eyebrow="Employer & affinity programmes" title="Cover for your people and members" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Employers, associations, cooperatives and member organisations can offer cover to their people through a programme arranged by a licensed broker, with simple enrolment and documents in every member’s wallet.
            </p>
            <CheckList
              className="mt-8"
              items={[
                "Member enrolment by link or bulk upload",
                "Group policy dashboard and usage reporting",
                "Mobile money premium collection, settled to the insurer",
                "Each member sees their own documents and broker contact",
              ]}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureCard icon={<Users />} title="Employers">Group personal accident, funeral and health programmes for staff.</FeatureCard>
            <FeatureCard icon={<Handshake />} title="Associations">Trader, transport and professional associations offering member cover.</FeatureCard>
            <FeatureCard icon={<Building2 />} title="Enterprises">Multi-site property and liability programmes with central oversight.</FeatureCard>
            <FeatureCard icon={<BadgeCheck />} title="Partners">Banks, fintechs and retailers embedding cover with a licensed broker.</FeatureCard>
          </div>
        </div>
      </Section>

      {enterprisePlans.length > 0 && (
        <Section labelledBy="ent-plans-title">
          <SectionHeading id="ent-plans-title" eyebrow="Programme administration" title="Plans for employers and affinity groups" />
          <PlanCards plans={enterprisePlans} />
        </Section>
      )}

      <Section id="enquire" tone="mist" labelledBy="enquire-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="enquire-title" eyebrow="Talk to our team" title="Tell us about your business" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">
              Tell us a little about your business. A licensed business adviser from a participating broker will call you back — usually within one working day.
            </p>
          </div>
          <LeadForm
            kind="enterprise"
            organization="required"
            organizationLabel="Business name"
            topicLabel="What do you need?"
            topics={topics}
            messageLabel="About your business"
            messagePlaceholder="What you do, where you operate, number of staff, and any cover you already have."
            submitLabel="Talk to our team"
            successBody="Thank you. A business adviser will contact you, usually within one working day."
          />
        </div>
      </Section>
    </>
  );
}
