import type { Metadata } from "next";
import { Building2, Rocket, Sparkles, Users } from "lucide-react";
import { Pill } from "@im/ui";
import { getCategories } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { LeadForm } from "@/components/marketing/lead-form";
import { StoreBadges } from "@/components/marketing/store-badges";

export const metadata: Metadata = {
  title: "Join the waitlist",
  description: "Get early access to Covva before public launch — compare and buy insurance in minutes with MoMo or card. Insurers and brokers: become a launch partner.",
  alternates: { canonical: "/waitlist" },
};

export default async function WaitlistPage() {
  const categories = await getCategories();
  const topics = categories.map((c) => ({ value: c.slug, label: c.name }));
  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Waitlist" }]}
        eyebrow={<span className="inline-flex items-center gap-2"><Rocket aria-hidden className="size-4" /> Pre-launch</span>}
        title={<>Be first to compare, buy and manage insurance <span className="text-brand">in minutes.</span></>}
        lede="We are onboarding a small group of customers, insurers and brokers before public launch. Join the waitlist for early access, or apply to become a launch partner."
      >
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Pill tone="ok">Early access</Pill>
          <StoreBadges size="sm" />
        </div>
      </PageHero>

      <Section id="customers" labelledBy="cust-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="cust-title" eyebrow="Customers" title="Early access for customers" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">Tell us what you would like to insure first. Early members get first access to the app, a launch discount funded by Covva, and a direct line to the team while we polish the experience.</p>
            <CheckList className="mt-6" items={["First to try the app on iOS and Android", "Launch discount on your first policy", "Diaspora? Pay in GBP, USD, EUR or CAD from day one"]} />
          </div>
          <LeadForm
            kind="customer"
            tag="waitlist"
            organization="hidden"
            topicLabel="What would you insure first?"
            topics={topics}
            messageLabel="Anything else?"
            messagePlaceholder="Optional — where you are based, what matters most to you."
            submitLabel="Join the waitlist"
            successTitle="You’re on the waitlist."
            successBody="We will email or message you with your early-access invitation before public launch."
          />
        </div>
      </Section>

      <Section id="partners" tone="mist" labelledBy="lp-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="lp-title" eyebrow="Insurers & brokers" title="Become a launch partner" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">A limited number of licensed insurers and brokers join the pilot with founding-partner terms: priority placement at launch, co-marketing, and a say in the roadmap.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <FeatureCard icon={<Building2 />} title="Insurers">Distribute approved products through licensed brokers; start with the portal, connect APIs when ready.</FeatureCard>
              <FeatureCard icon={<Users />} title="Brokers">Qualified leads, a free digital office, renewals on autopilot — your firm as broker of record.</FeatureCard>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted"><Sparkles aria-hidden className="size-4 text-brand" /> Founding-partner terms close when the pilot cohort is full.</p>
          </div>
          <LeadForm
            kindOptions={["insurer", "broker", "enterprise"]}
            defaultKind="insurer"
            tag="launch_partner"
            organization="required"
            messageLabel="About your organisation"
            messagePlaceholder="NIC licence number, classes of business, and what you would like from a launch partnership."
            submitLabel="Apply as a launch partner"
            successTitle="Thank you — application received."
            successBody="Our partnerships team will be in touch within two working days to arrange an introductory conversation."
          />
        </div>
      </Section>
    </>
  );
}
