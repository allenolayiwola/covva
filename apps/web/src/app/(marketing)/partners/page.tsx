import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";
import { DemoBadge, Notice, Pill } from "@im/ui";
import { getPartnerDirectory, type PublicOrg } from "@/lib/catalog";
import { displayOrgName, isDemoMode, isDemoOrg } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { OrgTile } from "@/components/marketing/org-tile";
import { REGULATION } from "@/components/marketing/content";
import { textLinkClass } from "@/components/marketing/ui-classes";

export const metadata: Metadata = {
  title: "Participating partners",
  description: "The licensed brokers and insurers participating in Covva, with their NIC licence numbers.",
  alternates: { canonical: "/partners" },
};

function OrgCard({ org, demo }: { org: PublicOrg; demo: boolean }) {
  const isDemo = demo && isDemoOrg(org.settings);
  return (
    <li className="flex flex-col rounded-card border border-line bg-white p-6">
      <div className="flex items-start gap-4">
        <OrgTile name={org.name} color={org.brand_color} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-ink">{displayOrgName(org.name)}</h3>
            {isDemo && <Pill>Demo</Pill>}
          </div>
          <p className="text-sm text-muted">{org.nic_licence_class ?? (org.type === "insurer" ? "Insurer" : "Insurance broker")}</p>
        </div>
      </div>
      {org.description && <p className="mt-4 text-[15px] leading-relaxed text-muted">{org.description}</p>}
      <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">NIC licence</dt>
          <dd className="font-medium tabular-nums text-ink">{org.nic_licence_number ?? "Being verified"}</dd>
        </div>
        {org.region && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Region</dt>
            <dd className="inline-flex items-center gap-1 font-medium text-ink"><MapPin aria-hidden className="size-3.5 text-subtle" />{org.region}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

export default async function PartnersPage() {
  const [{ brokers, insurers }, demo] = await Promise.all([getPartnerDirectory(), isDemoMode()]);
  const anyDemo = demo && [...brokers, ...insurers].some((o) => isDemoOrg(o.settings));

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Participating partners" }]}
        eyebrow="Participating partners"
        title="Who we work with"
        lede={`${insurers.length} participating insurer${insurers.length === 1 ? "" : "s"} and ${brokers.length} licensed broker${brokers.length === 1 ? "" : "s"}. We list partners only after verifying their licence and signing an agreement. This is not the whole market.`}
      >
        {anyDemo && (
          <Notice tone="wait" className="mt-8 max-w-2xl">
            The partners below are fictional and shown for demonstration only. They are not real companies and are not our partners.
          </Notice>
        )}
      </PageHero>

      <Section labelledBy="insurers-title">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="insurers-title" className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">Insurers</h2>
          {anyDemo && <DemoBadge />}
        </div>
        {insurers.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {insurers.map((o) => <OrgCard key={o.id} org={o} demo={demo} />)}
          </ul>
        ) : (
          <p className="text-muted">Insurer partners will be listed here once agreements are in place.</p>
        )}
      </Section>

      <Section tone="mist" labelledBy="brokers-title">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="brokers-title" className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">Brokers</h2>
          {anyDemo && <DemoBadge />}
        </div>
        {brokers.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {brokers.map((o) => <OrgCard key={o.id} org={o} demo={demo} />)}
          </ul>
        ) : (
          <p className="text-muted">Broker partners will be listed here once agreements are in place.</p>
        )}
        <div className="mt-10 flex flex-col gap-4 rounded-card border border-line bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] text-ink-2">Verify any licence with the regulator, or find out how to join.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href={REGULATION.nic.url} target="_blank" rel="noreferrer" className={textLinkClass}>
              NIC website <ExternalLink aria-hidden className="size-4" /><span className="sr-only">(opens in a new tab)</span>
            </a>
            <Link href="/brokers" className={textLinkClass}>Become a partner <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
        </div>
      </Section>
    </>
  );
}
