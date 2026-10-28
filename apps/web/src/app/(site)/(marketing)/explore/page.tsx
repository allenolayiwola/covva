import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { Notice, Pill, buttonClass } from "@im/ui";
import { CATEGORY_AVAILABILITY } from "@im/core";
import { getCategories } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { CategoryCard } from "@/components/marketing/category-card";
import { SEGMENT_LABELS } from "@/components/marketing/category-icon";
import { CtaBand } from "@/components/marketing/cta-band";

export const metadata: Metadata = {
  title: "Explore cover",
  description:
    "Motor, travel, home, health, life, business and specialist insurance in Ghana. See what each category covers, what to compare and how available it is today.",
  alternates: { canonical: "/explore" },
};

const SEGMENT_ORDER = ["personal", "business", "specialist"];

export default async function ExplorePage() {
  const categories = await getCategories();
  const segments = [...new Set([...SEGMENT_ORDER, ...categories.map((c) => c.segment)])]
    .map((seg) => ({ seg, items: categories.filter((c) => c.segment === seg) }))
    .filter((s) => s.items.length > 0);

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Explore cover" }]}
        eyebrow="Explore cover"
        title="Cover for what matters to you"
        lede="Every category shows what it covers, what to compare and how you can get it today. Availability depends on approved insurer arrangements — we label what we cannot offer yet rather than hide it."
        actions={
          <>
            <Link href="/get-started" className={buttonClass("primary", "lg")}>Help me choose</Link>
            <Link href="/how-it-works" className={buttonClass("secondary", "lg")}>How it works</Link>
          </>
        }
      />

      <Section className="pt-10! sm:pt-14!">
        <div className="mb-12 grid gap-3 sm:grid-cols-3">
          {(["integrated", "broker_assisted", "planned"] as const).map((k) => (
            <div key={k} className="rounded-card border border-line bg-white p-5">
              <Pill tone={CATEGORY_AVAILABILITY[k].tone}>{CATEGORY_AVAILABILITY[k].label}</Pill>
              <p className="mt-3 text-sm leading-relaxed text-muted">{CATEGORY_AVAILABILITY[k].promise}</p>
            </div>
          ))}
        </div>

        <div className="space-y-16">
          {segments.map(({ seg, items }) => {
            const label = SEGMENT_LABELS[seg] ?? { title: seg, description: "" };
            return (
              <section key={seg} aria-labelledby={`seg-${seg}`}>
                <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 id={`seg-${seg}`} className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{label.title}</h2>
                    {label.description && <p className="mt-1 text-[15px] text-muted">{label.description}</p>}
                  </div>
                  {seg !== "personal" && (
                    <Link href="/business" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
                      Business enquiries <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  )}
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((c) => (
                    <li key={c.id}>
                      <CategoryCard category={c} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {segments.length === 0 && (
            <Notice icon={<Info className="size-4" />} title="Categories are being updated">
              Please check back shortly, or <Link href="/contact" className="underline">contact us</Link>.
            </Notice>
          )}
        </div>
      </Section>

      <CtaBand
        title="Not sure where to start?"
        body="Answer a few questions and we will suggest the cover worth considering — with the reasons. It takes about two minutes and needs no sign-in."
        primary={{ label: "Help me choose", href: "/get-started" }}
        secondary={{ label: "Talk to us", href: "/contact" }}
      />
    </>
  );
}
