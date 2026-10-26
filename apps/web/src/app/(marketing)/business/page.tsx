import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Building2, ClipboardCheck, FileStack, Handshake, Users } from "lucide-react";
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
            <Link href="#enquire" className={buttonClass("primary", "lg")}>Request a call back</Link>
            <Link href="#categories" className={buttonClass("secondary", "lg")}>Business cover</Link>
          </>
        }
      />

      <Section id="categories" labelledBy="biz-cat-title">
        <SectionHeading id="biz-cat-title" eyebrow="Business categories" title="Cover for traders, SMEs and professionals" description="Availability depends on approved insurer arrangements. Specialist cover is arranged by specialist brokers." />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {business.map((c) => (
            <li key={c.id}><CategoryCard category={c} /></li>
          ))}
        </ul>
      </Section>

      <Section tone="mist" labelledBy="adviser-title">
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

      <Section labelledBy="programmes-title">
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
        <Section tone="mist" labelledBy="ent-plans-title">
          <SectionHeading id="ent-plans-title" eyebrow="Programme administration" title="Plans for employers and affinity groups" />
          <PlanCards plans={enterprisePlans} />
        </Section>
      )}

      <Section id="enquire" labelledBy="enquire-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="enquire-title" eyebrow="Business enquiry" title="Talk to a business adviser" className="mb-6! sm:mb-6!" />
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
            submitLabel="Request a call back"
            successBody="Thank you. A business adviser will contact you, usually within one working day."
          />
        </div>
      </Section>
    </>
  );
}
