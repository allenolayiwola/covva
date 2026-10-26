import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Mail, Newspaper, UserRoundCheck } from "lucide-react";
import { getBrand } from "@/components/marketing/brand";
import { getCategories } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { IconTile, Section } from "@/components/marketing/section";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Get in touch with the COVVA team — customers, brokers, insurers, businesses and press.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const [brand, categories] = await Promise.all([getBrand(), getCategories()]);
  const topics = categories.map((c) => ({ value: c.slug, label: c.name }));

  return (
    <>
      <PageHero breadcrumb={[{ label: "Contact" }]} eyebrow="Contact" title="Talk to us" lede="Whether you are looking for cover, want to partner with us or have a question about the platform, we would like to hear from you." />
      <Section className="pt-12! sm:pt-16!">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16">
          <div>
            <h2 className="sr-only">Contact form</h2>
            <LeadForm
              kindOptions={["customer", "broker", "insurer", "enterprise", "press", "other"]}
              topicLabel="Cover you are interested in"
              topics={topics}
            />
          </div>
          <aside aria-label="Other ways to reach us" className="space-y-4">
            {[
              { icon: UserRoundCheck, title: "Existing request or policy?", body: <>Message your broker from <Link href="/account" className="font-medium text-brand hover:underline">your account</Link> — they have your full history.</> },
              { icon: Mail, title: "Email", body: <a href={`mailto:${brand.supportEmail}`} className="break-all font-medium text-brand hover:underline">{brand.supportEmail}</a> },
              { icon: Building2, title: "Partnerships", body: <>See <Link href="/brokers" className="font-medium text-brand hover:underline">brokers</Link>, <Link href="/insurers" className="font-medium text-brand hover:underline">insurers</Link> or <Link href="/business" className="font-medium text-brand hover:underline">business</Link>.</> },
              { icon: Newspaper, title: "Press", body: "Choose “Press or media” in the form and we will route it to the right person." },
            ].map((c) => (
              <div key={c.title} className="flex gap-4 rounded-card border border-line bg-white p-5">
                <IconTile size="sm"><c.icon /></IconTile>
                <div>
                  <h3 className="font-semibold text-ink">{c.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{c.body}</p>
                </div>
              </div>
            ))}
          </aside>
        </div>
      </Section>
    </>
  );
}
