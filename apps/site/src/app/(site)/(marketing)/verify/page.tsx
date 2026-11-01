import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Building2, KeyRound, QrCode, ScanLine, ShieldCheck, UserRoundCheck } from "lucide-react";
import { getPartnerDirectory } from "@/lib/catalog";
import { displayOrgName } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { VerifyForm } from "@/components/marketing/verify-form";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "Verify a policy",
  description: "Public policy check for police, landlords, employers and partners: scan the QR code in a Covva wallet or enter the policy number and insurer to confirm a policy is valid. No personal data shown.",
  alternates: { canonical: "/verify" },
};

export default async function VerifyPage() {
  const directory = await getPartnerDirectory();
  const insurers = directory.insurers.map((i) => ({ slug: i.slug, name: displayOrgName(i.name) }));

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Verify a policy" }]}
        eyebrow={<span className="inline-flex items-center gap-2"><ScanLine aria-hidden className="size-4" /> Public verification</span>}
        title={<>Is this policy <span className="text-brand">valid?</span></>}
        lede="Scan the QR code on a Covva certificate or enter the policy number and insurer. You will see whether the policy is active, who issued it, the cover dates and the type of cover — nothing personal."
        aside={
          /* VerifyForm reads ?q= with useSearchParams, so it streams inside Suspense. */
          <Suspense fallback={<div aria-busy="true" className="h-[320px] animate-pulse rounded-[24px] bg-white motion-reduce:animate-none" />}>
            <VerifyForm insurers={insurers} />
          </Suspense>
        }
      />

      <Section labelledBy="who-title">
        <SectionHeading id="who-title" eyebrow="Who uses this" title="Confirm cover in seconds" />
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={<ShieldCheck />} title="Police and road checks">Scan the QR code in the driver’s wallet instead of inspecting a paper sticker. The result shows the insurer and cover dates straight from the issued record.</FeatureCard>
          <FeatureCard icon={<KeyRound />} title="Landlords and employers">Check a tenant’s contents policy or a contractor’s liability cover before you hand over keys or sign a contract.</FeatureCard>
          <FeatureCard icon={<Building2 />} title="Partners and lenders">Banks, dealers and fleets confirm a vehicle or asset is insured before releasing finance or goods.</FeatureCard>
        </div>
      </Section>

      <Section tone="mist" labelledBy="how-v-title">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading id="how-v-title" eyebrow="How it works" title="What the check does — and does not — show" className="mb-6! sm:mb-6!" />
            <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
              <li className="flex gap-3"><QrCode aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />Every policy issued through Covva carries a QR code that opens this page with the policy number filled in.</li>
              <li className="flex gap-3"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />We check the insurer’s issued record and show: valid or not, insurer, cover start and end, type of cover.</li>
              <li className="flex gap-3"><UserRoundCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />We never show the customer’s name, phone, address, vehicle registration or premium.</li>
            </ul>
            <p className="mt-6 text-[14px] leading-relaxed text-muted">A “not found” result is not proof that someone is uninsured. Policies bought outside Covva must be checked with the insurer directly. Lookups are rate-limited to prevent abuse.</p>
          </div>
          <div className="rounded-card border border-line bg-white p-6">
            <h3 className="text-[20px] leading-[1.25] text-ink">For insurers and partners</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Need verification inside your own systems? The same check is available as an API for licensed partners, with scoped keys and audit logs.</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/partners/embedded" className={textLinkClass}>Embedded partners <ArrowRight aria-hidden className="size-4" /></Link>
              <Link href="/insurers" className={textLinkClass}>For insurers <ArrowRight aria-hidden className="size-4" /></Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
