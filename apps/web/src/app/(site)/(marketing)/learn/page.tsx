import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Clock } from "lucide-react";
import { Pill } from "@im/ui";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { LearnArticleLink } from "@/components/marketing/learn-article-link";
import { JsonLd } from "@/components/marketing/json-ld";
import { getArticleLocales, getArticles } from "@/server/cms";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Learn — the plain-language insurance guide",
  description: "Plain-language articles about insurance in Ghana: comprehensive vs third party, how to make a claim, insurance for diaspora families, renewals, excess and more. English now; Twi, Ga and Ewe coming.",
  alternates: { canonical: "/learn" },
};

export default async function LearnPage() {
  // CMS articles when any are published, otherwise the typed list (docs/CMS.md).
  const [ARTICLES, locales] = await Promise.all([getArticles(), getArticleLocales()]);
  const topics = [...new Set(ARTICLES.map((a) => a.topic))];
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Covva insurance guide",
          url: `${siteUrl()}/learn`,
          hasPart: ARTICLES.map((a) => ({ "@type": "Article", headline: a.title, url: `${siteUrl()}/learn/${a.slug}`, datePublished: a.published })),
        }}
      />
      <PageHero
        breadcrumb={[{ label: "Learn" }]}
        eyebrow={<span className="inline-flex items-center gap-2"><BookOpen aria-hidden className="size-4" /> Insurance guide</span>}
        title={<>Insurance, <span className="text-brand">explained simply.</span></>}
        lede="Short, plain-language guides written for Ghana — no jargon, no sales pitch. Read before you buy, or when something goes wrong."
      >
        <div className="mt-8"><LanguageSwitcher available={locales} /></div>
      </PageHero>

      <Section labelledBy="articles-title" className="pt-10! sm:pt-14!">
        <h2 id="articles-title" className="sr-only">Articles</h2>
        <ul className="mb-8 flex flex-wrap gap-2" aria-label="Topics">
          {topics.map((t) => (
            <li key={t}><Pill>{t}</Pill></li>
          ))}
        </ul>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ARTICLES.map((a) => (
            <li key={a.slug}>
              {/* Follows the chosen language: /learn/<slug> in English, /learn/<slug>/<lang> otherwise. */}
              <LearnArticleLink
                slug={a.slug}
                available={locales}
                translations={a.availableLocales}
                className="group flex h-full flex-col rounded-card border border-line bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <Pill>{a.topic}</Pill>
                  <span className="inline-flex items-center gap-1 text-[13px] text-muted"><Clock aria-hidden className="size-3.5" /> {a.readMinutes} min</span>
                </div>
                <h3 className="mt-4 text-[20px] leading-[1.25] md:text-[24px] text-ink">{a.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{a.summary}</p>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-brand">
                  Read <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </span>
              </LearnArticleLink>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[14px] text-muted"> Have a question we have not answered? <Link href="/support" className="font-medium text-brand hover:underline">Ask the help centre</Link>.
        </p>
      </Section>
    </>
  );
}
