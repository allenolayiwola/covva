import { sitePath } from "@/lib/site-url";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Globe2, Package } from "lucide-react";
import { bundleQuote, formatGHS } from "@im/core";
import { Notice, Pill, buttonClass } from "@im/ui";
import { getCategories } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, FeatureCard, Section, SectionHeading } from "@/components/marketing/section";
import { CategoryIcon } from "@/components/marketing/category-icon";
import { CtaBand } from "@/components/marketing/cta-band";
import { PaymentBadges } from "@/components/marketing/payment-badges";
import { DIASPORA_CURRENCIES, DIASPORA_EXAMPLES } from "@/components/marketing/content";
import { getFromPrices } from "@/components/marketing/pricing";
import { getPublishedBundle, listPublishedBundles } from "@/server/bundles";

export async function generateStaticParams() {
  const bundles = await listPublishedBundles().catch(() => []);
  return bundles.length ? bundles.map((b) => ({ slug: b.slug })) : [{ slug: "parents-care-pack" }];
}

export async function generateMetadata({ params }: PageProps<"/bundles/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getPublishedBundle(slug);
  if (!bundle) return { title: "Bundle not found", robots: { index: false } };
  const description = bundle.description ?? `${bundle.name}: a bundle of cover for family in Ghana, paid from abroad.`;
  return { title: `${bundle.name} — cover for family in Ghana`, description, alternates: { canonical: `/bundles/${bundle.slug}` }, openGraph: { title: bundle.name, description, url: `/bundles/${bundle.slug}`, images: [sitePath("/opengraph-image")] } };
}

/** `params` is request-time data under Cache Components: the content streams inside Suspense. */
export default function BundlePage({ params }: PageProps<"/bundles/[slug]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-16"><div className="h-10 w-2/3 animate-pulse rounded bg-mist" /><div className="mt-6 h-40 animate-pulse rounded-card bg-mist" /></div>}>
      <BundleContent params={params} />
    </Suspense>
  );
}

async function BundleContent({ params }: Pick<PageProps<"/bundles/[slug]">, "params">) {
  const { slug } = await params;
  const bundle = await getPublishedBundle(slug);
  if (!bundle) notFound();
  const [categories, prices] = await Promise.all([getCategories(), getFromPrices()]);
  // Indicative annual GHS estimate per item: the catalogue's lowest approved premium, else the marketing examples.
  const estimates: Record<string, number | null> = {};
  for (const it of bundle.parsedItems) {
    const example = DIASPORA_EXAMPLES.find((e) => e.categorySlug === it.category_slug);
    estimates[it.category_slug] = prices[it.category_slug] ?? example?.ghsPerYear ?? null;
  }
  const quote = bundleQuote({ items: bundle.parsedItems, discount_pct: Number(bundle.discount_pct) }, estimates);
  const gbp = DIASPORA_CURRENCIES.find((c) => c.code === "GBP")!;
  const monthlyGhs = quote.total / 12;
  const items = bundle.parsedItems.map((it) => ({ ...it, category: categories.find((c) => c.slug === it.category_slug), line: quote.lines.find((l) => l.category_slug === it.category_slug) }));
  const getStarted = `/get-started?bundle=${encodeURIComponent(bundle.slug)}`;

  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Diaspora", href: "/diaspora" }, { label: bundle.name }]}
        eyebrow={<span className="inline-flex items-center gap-2"><Package aria-hidden className="size-4" /> Bundle · {bundle.audience === "diaspora" ? "for sponsors abroad" : bundle.audience}</span>}
        title={<>{bundle.name}</>}
        lede={bundle.description ?? "A set of cover types requested together and quoted by a participating broker."}
        actions={
          <>
            <Link href={getStarted} className={buttonClass("primary", "lg")}>Price this pack <ArrowRight aria-hidden className="size-4" /></Link>
            <Link href="/diaspora" className={buttonClass("secondary", "lg")}>More for diaspora families</Link>
          </>
        }
        aside={
          <div className="rounded-[24px] border border-line bg-white p-6 shadow-float">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Indicative bundle estimate</p>
            <p className="mt-2 text-[34px] font-bold leading-none text-ink">{quote.total > 0 ? `${formatGHS(Math.round(monthlyGhs))}` : "Quote on request"}<span className="text-base font-normal text-muted">{quote.total > 0 ? " / month" : ""}</span></p>
            {quote.total > 0 && <p className="mt-1 text-sm text-muted">≈ £{(monthlyGhs / gbp.ghsPerUnit).toLocaleString("en-GB", { maximumFractionDigits: 0 })} a month · {formatGHS(quote.total)} a year{quote.discount > 0 ? ` after a ${quote.discountPct}% bundle discount` : ""}</p>}
            <ul className="mt-4 space-y-2 text-sm">
              {items.map((it) => (
                <li key={it.category_slug} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-ink-2">{it.category && <CategoryIcon icon={it.category.icon} className="size-4 text-brand" />}{it.category?.name ?? it.category_slug}{!it.required && <Pill tone="neutral">optional</Pill>}</span>
                  <span className="font-medium text-ink">{it.line?.premium != null ? `${formatGHS(it.line.premium)}/yr` : "on request"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-subtle">Estimates from participating insurers&apos; lowest published premiums; the binding price is the insurer&apos;s quote for the people and property insured. Pay in GBP, USD, EUR or CAD — the insurer receives cedis.</p>
            <PaymentBadges compact className="mt-4" />
          </div>
        }
      />

      <Section labelledBy="bundle-items-title">
        <SectionHeading id="bundle-items-title" eyebrow="What's in the pack" title="One request, every part itemised" description="Each part is its own policy with its insurer, quoted together by one broker of record. Leave out what you don't need." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <FeatureCard key={it.category_slug} icon={<CategoryIcon icon={it.category?.icon ?? "shield"} />} title={it.category?.name ?? it.category_slug}>
              {it.category?.short_description ?? "Quoted by a participating insurer."}
              {it.category?.availability === "planned" && <span className="mt-2 block text-xs text-amber">Not sold online yet — the broker arranges it.</span>}
            </FeatureCard>
          ))}
        </div>
        {!quote.complete && <Notice tone="info" className="mt-6" title="Some parts are priced on request">The broker quotes {quote.missing.join(", ")} after a short call. Nothing is bought until you accept a binding quote and pay the insurer.</Notice>}
      </Section>

      <Section tone="mist" labelledBy="bundle-how-title">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading id="bundle-how-title" eyebrow="How it works from abroad" title="Three steps" className="mb-6! sm:mb-6!" />
            <ol className="space-y-3">
              {[
                "Start with the first part and add your relative's details. The other parts are saved as drafts in your account.",
                "A named broker prepares one comparison per part from participating insurers and confirms the bundle total.",
                "Pay by card in your currency — monthly or yearly as a sponsor. Each insurer receives cedis and issues its policy to both wallets.",
              ].map((s, i) => (
                <li key={s} className="flex gap-4 rounded-card border border-line bg-white p-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold tabular-nums text-white">{i + 1}</span>
                  <p className="pt-1 text-[15px] leading-relaxed text-ink-2">{s}</p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <FeatureCard icon={<Globe2 />} title="Pay in your currency, transparently">
              The price in GBP, USD, EUR or CAD is shown before you confirm with the rate used and its source. The cedi amount is the contract amount; your card issuer applies the final rate.
            </FeatureCard>
            <CheckList className="mt-6" items={["No diaspora mark-up on the insurer's premium", "Both of you get every certificate, reminder and claim update", "Pause or cancel recurring payments from your account at any time"]} />
          </div>
        </div>
      </Section>

      <CtaBand title={`Price the ${bundle.name}`} body="Start with one part; your broker quotes the rest." primary={{ label: "Get started", href: getStarted }} secondary={{ label: "Talk to a broker", href: "/contact?topic=diaspora" }} />
    </>
  );
}
