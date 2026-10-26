import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Hospital, MapPin, Phone, Truck, Wrench } from "lucide-react";
import { Notice, Pill } from "@im/ui";
import { PageHero } from "@/components/marketing/page-hero";
import { Section, SectionHeading } from "@/components/marketing/section";
import { textLinkClass } from "@/components/marketing/ui-classes";
import { getPartnerDirectory } from "@/lib/catalog";
import { getApprovedServicePartners, groupPartners } from "@/lib/service-partners";

export const metadata: Metadata = {
  title: "Claims partner network",
  description: "Approved garages, towing services, hospitals and clinics that work with insurers on Covva, by region. Direct billing where agreed, so you do not pay upfront.",
  alternates: { canonical: "/claims/network" },
};

export default function NetworkPage() {
  return (
    <>
      <PageHero
        eyebrow="Partner network"
        title="Approved garages, towing and hospitals"
        lede="Where to go after a claim. Each partner below has been approved for the network; where your insurer has agreed direct billing, the partner invoices the insurer and you do not pay upfront."
      />
      <Section labelledBy="directory-title">
        <SectionHeading id="directory-title" eyebrow="Directory" title="By region" description="Updated as insurers confirm their networks. Your broker confirms which partner to use for your claim." />
        <Suspense fallback={<p className="text-[14.5px] text-muted">Loading the directory…</p>}>
          <Directory />
        </Suspense>
        <Notice tone="neutral" className="mt-8">
          Covva lists partners approved for the network; it does not carry out repairs or treatment and does not decide claims. Only the insurer approves and pays a claim. Ratings will appear once customers have used a partner through the app.
        </Notice>
        <p className="mt-6 text-[14.5px]">
          <Link href="/claims" className={textLinkClass}>Back to how claims work <ArrowRight aria-hidden className="size-4" /></Link>
        </p>
      </Section>
    </>
  );
}

const ICON: Record<string, React.ReactNode> = {
  garage: <Wrench aria-hidden className="size-4" />,
  towing: <Truck aria-hidden className="size-4" />,
  hospital: <Hospital aria-hidden className="size-4" />,
  clinic: <Hospital aria-hidden className="size-4" />,
  pharmacy: <Hospital aria-hidden className="size-4" />,
  assessor: <Wrench aria-hidden className="size-4" />,
};

async function Directory() {
  const [partners, { insurers }] = await Promise.all([getApprovedServicePartners(), getPartnerDirectory()]);
  const insurerName = new Map(insurers.map((i) => [i.id, i.name]));
  const groups = groupPartners(partners);
  if (!groups.length) {
    return (
      <p className="rounded-card border border-line bg-mist/40 px-5 py-8 text-center text-[15px] text-muted">
        No partners have been published yet. Your broker tells you where to go when you report a claim.
      </p>
    );
  }
  return (
    <div className="space-y-10">
      {groups.map((g) => (
        <section key={g.region} aria-labelledby={`region-${g.region.replace(/\W+/g, "-")}`}>
          <h3 id={`region-${g.region.replace(/\W+/g, "-")}`} className="flex items-center gap-2 text-[19px] font-semibold tracking-tight text-ink"><MapPin aria-hidden className="size-4 text-brand" /> {g.region}</h3>
          {g.kinds.map((k) => (
            <div key={k.kind} className="mt-4">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">{ICON[k.kind]} {k.label}</p>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {k.partners.map((p) => {
                  const billing = (p.direct_billing_insurer_ids ?? []).map((id) => insurerName.get(id)).filter(Boolean) as string[];
                  return (
                    <li key={p.id} className="rounded-card border border-line bg-white p-4">
                      <p className="font-semibold text-ink">{p.name}</p>
                      {p.address && <p className="mt-0.5 text-[13.5px] text-muted">{p.address}</p>}
                      {p.phone && <a href={`tel:${p.phone}`} className="mt-1 inline-flex items-center gap-1 text-[13.5px] font-medium text-brand hover:underline"><Phone aria-hidden className="size-3.5" />{p.phone}</a>}
                      {p.services?.length ? <p className="mt-2 text-[12.5px] text-muted">{p.services.join(" · ")}</p> : null}
                      {billing.length > 0 && (
                        <p className="mt-2 flex flex-wrap gap-1">
                          <Pill tone="ok">Direct billing</Pill>
                          <span className="text-[12px] text-muted">with {billing.join(", ")} — you don&apos;t pay upfront</span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
