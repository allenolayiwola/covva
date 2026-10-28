import Link from "next/link";
import { ArrowRight, Clock, Languages } from "lucide-react";
import { Container, Notice, Pill } from "@im/ui";
import { localeDef, type CmsLocale } from "@im/core";
import type { ArticleView } from "@/server/cms";
import { LanguageSwitcher } from "./language-switcher";
import { JsonLd } from "./json-ld";
import { CtaBand } from "./cta-band";
import { RichText } from "./rich-text";
import { textLinkClass } from "./ui-classes";
import { siteUrl } from "@/lib/site-url";

/** Learn article body shared by /learn/[slug] (English) and /learn/[slug]/[lang] (translations). */
export function ArticleBody({ article: a, others, locale }: { article: ArticleView; others: { slug: string; title: string }[]; locale: CmsLocale }) {
  const path = locale === "en" ? `/learn/${a.slug}` : `/learn/${a.slug}/${locale}`;
  const def = localeDef(locale);
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: a.title,
          description: a.summary,
          datePublished: a.published,
          dateModified: a.updated ?? a.published,
          inLanguage: a.translated ? def.htmlLang : "en-GH",
          url: `${siteUrl()}${path}`,
          mainEntityOfPage: `${siteUrl()}${path}`,
          author: { "@type": "Organization", name: a.author || "Covva" },
          publisher: { "@type": "Organization", name: "Covva", logo: { "@type": "ImageObject", url: `${siteUrl()}/icon-512.png` } },
          articleSection: a.topic,
          ...(a.coverImage ? { image: a.coverImage.url } : {}),
        }}
      />
      <div className="border-b border-line bg-gradient-to-b from-mist to-white">
        <Container className="py-12 sm:py-16">
          <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li><Link href="/" className="rounded hover:text-brand">Home</Link></li>
              <li aria-hidden>/</li>
              <li><Link href="/learn" className="rounded hover:text-brand">Learn</Link></li>
              <li aria-hidden>/</li>
              <li><span aria-current="page" className="text-ink-2">{a.topic}</span></li>
            </ol>
          </nav>
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Pill>{a.topic}</Pill>
              <span className="inline-flex items-center gap-1 text-[13px] text-muted"><Clock aria-hidden className="size-3.5" /> {a.readMinutes} min read</span>
            </div>
            <h1 className="mt-4 text-balance text-[34px] font-bold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[46px]">{a.title}</h1>
            <p className="mt-4 text-[18px] leading-relaxed text-muted">{a.summary}</p>
            <p className="mt-4 text-[13px] text-subtle">Published {new Date(a.published).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · General information, not advice.</p>
          </div>
          <div className="mt-8 max-w-3xl space-y-4">
            <LanguageSwitcher available={a.availableLocales} slug={a.slug} current={locale} />
            {locale !== "en" && !a.translated && (
              <Notice tone="info" icon={<Languages className="size-4" />} title={`${def.label} translation in progress`}>
                This guide is not available in {def.native} yet, so the English text is shown. Translations are written by people, never machine-generated.
              </Notice>
            )}
          </div>
        </Container>
      </div>

      <Container className="py-10 sm:py-14">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <article className="max-w-3xl" lang={a.translated ? def.htmlLang : "en-GH"}>
            <RichText nodes={a.body} />
            <div className="mt-10 rounded-card border border-line bg-mist p-5 text-[14px] leading-relaxed text-muted">
              This guide is general information about insurance in Ghana. It is not advice about your circumstances — your named broker advises on those. Policy wording from the insurer always applies.
            </div>
          </article>
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {a.related.length > 0 && (
              <div className="rounded-card border border-line bg-white p-5">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Related</h2>
                <ul className="mt-3 space-y-2">
                  {a.related.map((r) => (
                    <li key={r.href}><Link href={r.href} className={textLinkClass}>{r.label} <ArrowRight aria-hidden className="size-4" /></Link></li>
                  ))}
                </ul>
              </div>
            )}
            {others.length > 0 && (
              <div className="rounded-card border border-line bg-white p-5">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">More guides</h2>
                <ul className="mt-3 space-y-3">
                  {others.map((o) => (
                    <li key={o.slug}>
                      <Link href={`/learn/${o.slug}`} className="block rounded text-[15px] font-medium text-ink hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{o.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </Container>

      <CtaBand title="Ready to compare?" body="Get indicative quotes in minutes from participating licensed insurers." primary={{ label: "Get quotes", href: "/#quote" }} secondary={{ label: "More guides", href: "/learn" }} />
    </>
  );
}

export function ArticleSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="border-b border-line bg-gradient-to-b from-mist to-white">
      <Container className="py-20">
        <span className="sr-only">Loading article…</span>
        <div className="h-4 w-40 animate-pulse rounded bg-line motion-reduce:animate-none" />
        <div className="mt-6 h-12 w-2/3 max-w-xl animate-pulse rounded-lg bg-line motion-reduce:animate-none" />
        <div className="mt-5 h-5 w-full max-w-2xl animate-pulse rounded bg-line/70 motion-reduce:animate-none" />
      </Container>
    </div>
  );
}

/** "More guides": the editor's picks, else the three most recent other articles. */
export function moreGuides(a: ArticleView, all: ArticleView[]): { slug: string; title: string }[] {
  if (a.relatedArticles.length > 0) return a.relatedArticles;
  return all.filter((x) => x.slug !== a.slug).slice(0, 3).map((x) => ({ slug: x.slug, title: x.title }));
}
