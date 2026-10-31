import { pageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Ban, Clock, CreditCard, FileText, Info, QrCode, ShieldCheck } from "lucide-react";
import { Notice, Pill } from "@im/ui";
import { getCategories } from "@/lib/catalog";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { CategoryIcon } from "@/components/marketing/category-icon";
import { FaqList } from "@/components/marketing/faq-list";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";
import { CtaBand } from "@/components/marketing/cta-band";
import { QuoteWidget } from "@/components/marketing/quote-widget";
import { RenewalReminderForm } from "@/components/marketing/renewal-reminder-form";
import { PaymentBadges } from "@/components/marketing/payment-badges";
import { PRODUCT_LINES, findProductLine } from "@/components/marketing/products-content";
import { getFromPrices, monthlyFrom } from "@/components/marketing/pricing";
import { textLinkClass } from "@/components/marketing/ui-classes";
import { siteUrl } from "@/lib/site-url";

export function generateStaticParams() {
  return PRODUCT_LINES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/insurance/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const line = findProductLine(slug);
  if (!line) return { title: "Cover not found", robots: { index: false } };
  const title = `${line.name} in Ghana`;
  return pageMetadata({ title, description: line.lede, path: `/insurance/${line.slug}` });
}

/** `params` is request-time data under Cache Components, so the content streams inside Suspense. */
export default function ProductLinePage({ params }: PageProps<"/insurance/[slug]">) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductLineContent params={params} />
    </Suspense>
  );
}

async function ProductLineContent({ params }: Pick<PageProps<"/insurance/[slug]">, "params">) {
  const { slug } = await params;
  const line = findProductLine(slug);
  if (!line) notFound();

  const [categories, prices] = await Promise.all([getCategories(), getFromPrices()]);
  const from = monthlyFrom(prices, line.categorySlugs, line.fromMonthlyGhs);
  const primaryCategory = categories.find((c) => c.slug === line.categorySlugs[0]);
  const quoteCategories = categories.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, availability: c.availability }));
  const reminderCategories = categories.map((c) => ({ slug: c.slug, name: c.name }));
  const planned = !primaryCategory || primaryCategory.availability === "planned";

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: line.name,
    description: line.lede,
    url: `${siteUrl()}/insurance/${line.slug}`,
    serviceType: "Insurance comparison and access through licensed partners",
    areaServed: { "@type": "Country", name: "Ghana" },
    provider: { "@type": "Organization", name: "Covva", url: siteUrl(), description: "Technology platform. Licensed partner brokers arrange cover; licensed partner insurers issue policies." },
  };

  return (
    <>
      <JsonLd data={productJsonLd} />
      <JsonLd data={faqJsonLd(line.faqs)} />

      <PageHero
        breadcrumb={[{ label: "Insurance", href: "/explore" }, { label: line.short }]}
        eyebrow={<span className="inline-flex items-center gap-2"><CategoryIcon icon={line.icon} className="size-4" /> {line.name}</span>}
        title={line.headline}
        lede={line.lede}
        aside={<QuoteWidget categories={quoteCategories} defaultSlug={line.categorySlugs[0]} title={`${line.short} quotes`} />}
      >
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="text-[15px] text-ink-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">From </span>
            <span className="text-[28px] font-semibold tabular-nums text-ink">GH₵ {from.monthly}</span>
            <span className="text-muted">/month</span>
            <Pill tone="wait" className="ml-2 align-middle">Indicative</Pill>
          </p>
          {planned && <Pill tone="wait">Coming soon — register interest</Pill>}
        </div>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
          {from.source === "catalog" ? "Lowest minimum premium across approved products from participating insurers, shown monthly." : "Typical starting price for this type of cover in Ghana."} Your price depends on what you insure; the exact figure is confirmed on your quote.
        </p>
      </PageHero>

      {/* Covers / not covered */}
      <Section labelledBy="covers-title">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <SectionHeading id="covers-title" eyebrow="What it covers" title="What you are protected against" className="mb-6! sm:mb-6!" />
            <ul className="space-y-3">
              {line.covers.map((c) => (
                <li key={c} className="flex items-start gap-3 rounded-card border border-line bg-white p-4">
                  <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                  <span className="text-[15px] leading-relaxed text-ink-2">{c}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SectionHeading id="not-title" eyebrow="What it doesn’t" title="Common exclusions to know about" className="mb-6! sm:mb-6!" />
            <ul className="space-y-3">
              {line.notCovered.map((c) => (
                <li key={c} className="flex items-start gap-3 rounded-card border border-line bg-mist p-4">
                  <Ban aria-hidden className="mt-0.5 size-5 shrink-0 text-amber" />
                  <span className="text-[15px] leading-relaxed text-ink-2">{c}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] leading-relaxed text-muted">Each insurer’s wording differs. Your quote lists the exact exclusions and your broker explains them before you buy.</p>
          </div>
        </div>
      </Section>

      {line.compare && (
        <Section tone="mist" labelledBy="compare-title">
          <SectionHeading id="compare-title" eyebrow="Choosing cover" title={line.compare.title} description={line.compare.intro} />
          <div className="grid gap-4 md:grid-cols-3">
            {line.compare.options.map((o, i) => (
              <article key={o.name} className={`flex flex-col rounded-[20px] border bg-white p-6 ${i === line.compare!.options.length - 1 ? "border-brand shadow-float" : "border-line"}`}>
                <h3 className="text-xl font-semibold tracking-tight text-ink">{o.name}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-muted">{o.who}</p>
                <CheckList className="mt-5" items={o.covers} />
                <p className="mt-auto border-t border-line pt-4 text-[13.5px] text-ink-2"><span className="font-semibold">Price: </span>{o.price}</p>
              </article>
            ))}
          </div>
        </Section>
      )}

      {/* Price, instalments, callout */}
      <Section labelledBy="price-title">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-card border border-line bg-white p-6">
            <IconTile><CreditCard /></IconTile>
            <h2 id="price-title" className="mt-5 text-[19px] font-semibold tracking-tight text-ink">Example prices</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              From <span className="font-semibold text-ink">GH₵ {from.monthly}/month</span> (about GH₵ {from.monthly * 12} a year). Indicative only — the premium depends on the sum insured, your details and the insurer.
            </p>
            <PaymentBadges compact className="mt-4" />
          </div>
          <div className="rounded-card border border-line bg-white p-6">
            <IconTile><Clock /></IconTile>
            <h3 className="mt-5 text-[19px] font-semibold tracking-tight text-ink">Instalment options</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{line.instalments}</p>
          </div>
          {line.callout ? (
            <div className="rounded-card border border-line bg-mint/60 p-6 text-ink">
              <span aria-hidden className="inline-grid size-11 place-items-center rounded-xl bg-white text-brand"><QrCode className="size-5" /></span>
              <h3 className="mt-5 text-[19px] font-semibold tracking-tight">{line.callout.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{line.callout.body}</p>
              <Link href="/verify" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline-offset-4 hover:underline">Verify a policy <ArrowRight aria-hidden className="size-4" /></Link>
            </div>
          ) : (
            <div className="rounded-card border border-line bg-mint/60 p-6 text-ink">
              <span aria-hidden className="inline-grid size-11 place-items-center rounded-xl bg-white text-brand"><QrCode className="size-5" /></span>
              <h3 className="mt-5 text-[19px] font-semibold tracking-tight">Digital wallet with QR verification</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">Your certificate lives in the Covva wallet, offline, with a QR code anyone can scan to confirm the policy is valid — without seeing your personal details.</p>
              <Link href="/verify" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline-offset-4 hover:underline">Verify a policy <ArrowRight aria-hidden className="size-4" /></Link>
            </div>
          )}
        </div>
      </Section>

      {/* Claims */}
      <Section tone="mist" labelledBy="claims-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
          <div>
            <SectionHeading id="claims-title" eyebrow="If something happens" title={`How ${line.short.toLowerCase()} claims work`} className="mb-6! sm:mb-6!" />
            <ol className="space-y-3">
              {line.claims.steps.map((s, i) => (
                <li key={s} className="flex gap-4 rounded-card border border-line bg-white p-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold tabular-nums text-white">{i + 1}</span>
                  <p className="pt-1 text-[15px] leading-relaxed text-ink-2">{s}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-start gap-2 text-[14px] leading-relaxed text-muted"><Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />{line.claims.timeline}</p>
          </div>
          <div>
            <h3 className="text-[19px] font-semibold tracking-tight text-ink">What you will need</h3>
            <ul className="mt-4 space-y-3">
              {line.claims.documents.map((d) => (
                <li key={d} className="flex items-center gap-3 rounded-card border border-line bg-white p-4">
                  <IconTile size="sm"><FileText /></IconTile>
                  <span className="text-[15px] text-ink-2">{d}</span>
                </li>
              ))}
            </ul>
            <Notice tone="info" icon={<Info className="size-4" />} className="mt-5">
              The insurer decides every claim. Reporting a claim does not mean it is approved — but your broker helps you get the file right first time.
            </Notice>
            <Link href="/claims" className={`${textLinkClass} mt-5`}>How claims work on Covva <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
        </div>
      </Section>

      {/* FAQ + renewal reminder */}
      <Section labelledBy="pl-faq-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16">
          <div>
            <h2 id="pl-faq-title" className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[36px]">{line.short}: common questions</h2>
            <FaqList items={line.faqs} className="mt-6" />
            {primaryCategory && (
              <p className="mt-4 text-[14px] text-muted">
                Want the detail? <Link href={`/explore/${primaryCategory.slug}`} className="font-medium text-brand hover:underline">See what to compare for {primaryCategory.name.toLowerCase()}</Link>.
              </p>
            )}
          </div>
          <RenewalReminderForm categories={reminderCategories} defaultCategory={line.categorySlugs[0]} />
        </div>
      </Section>

      <CtaBand
        title={planned ? `${line.short} is coming.` : `Ready to compare ${line.short.toLowerCase()} cover?`}
        body={planned ? "Register your interest and we will tell you when participating insurers can support it." : "Get indicative quotes in minutes. Your named broker confirms the final price with the insurer before you pay."}
        primary={planned ? { label: "Register interest", href: `/contact?topic=${line.categorySlugs[0]}` } : { label: "Get quotes", href: `/get-started?category=${line.categorySlugs[0]}` }}
        secondary={{ label: "Help me choose", href: "/get-started" }}
      />
    </>
  );
}

function ProductSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="border-b border-line bg-gradient-to-b from-mist to-white">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 lg:px-8">
        <span className="sr-only">Loading cover details…</span>
        <div className="h-4 w-40 animate-pulse rounded bg-line motion-reduce:animate-none" />
        <div className="mt-6 h-12 w-2/3 max-w-xl animate-pulse rounded-lg bg-line motion-reduce:animate-none" />
        <div className="mt-5 h-5 w-full max-w-2xl animate-pulse rounded bg-line/70 motion-reduce:animate-none" />
        <div className="mt-8 h-72 w-full max-w-md animate-pulse rounded-[24px] bg-mint-2 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
