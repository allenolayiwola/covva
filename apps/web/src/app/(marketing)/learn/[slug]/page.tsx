import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Clock, Lightbulb } from "lucide-react";
import { Container, Notice, Pill } from "@im/ui";
import { ARTICLES, findArticle, type ArticleBlock } from "@/components/marketing/articles";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { JsonLd } from "@/components/marketing/json-ld";
import { CtaBand } from "@/components/marketing/cta-band";
import { textLinkClass } from "@/components/marketing/ui-classes";
import { siteUrl } from "@/lib/site-url";

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const a = findArticle(slug);
  if (!a) return { title: "Article not found", robots: { index: false } };
  return {
    title: a.title,
    description: a.summary,
    alternates: { canonical: `/learn/${a.slug}` },
    openGraph: { type: "article", title: a.title, description: a.summary, url: `/learn/${a.slug}`, publishedTime: a.published, modifiedTime: a.updated ?? a.published, images: ["/opengraph-image"] },
  };
}

export default function ArticlePage({ params }: PageProps<"/learn/[slug]">) {
  return <ArticleContent params={params} />;
}

function Block({ b }: { b: ArticleBlock }) {
  switch (b.type) {
    case "h2":
      return <h2 className="mt-10 text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">{b.text}</h2>;
    case "ul":
      return (
        <ul className="mt-4 list-disc space-y-2 pl-6 text-[17px] leading-relaxed text-ink-2 marker:text-brand">
          {b.items.map((it) => <li key={it}>{it}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-[17px] leading-relaxed text-ink-2 marker:font-semibold marker:text-brand">
          {b.items.map((it) => <li key={it}>{it}</li>)}
        </ol>
      );
    case "tip":
      return (
        <Notice tone="ok" icon={<Lightbulb className="size-4" />} title="Tip" className="mt-6">
          {b.text}
        </Notice>
      );
    default:
      return <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{b.text}</p>;
  }
}

async function ArticleContent({ params }: Pick<PageProps<"/learn/[slug]">, "params">) {
  const { slug } = await params;
  const a = findArticle(slug);
  if (!a) notFound();
  const others = ARTICLES.filter((x) => x.slug !== a.slug).slice(0, 3);

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
          inLanguage: "en-GH",
          url: `${siteUrl()}/learn/${a.slug}`,
          mainEntityOfPage: `${siteUrl()}/learn/${a.slug}`,
          author: { "@type": "Organization", name: "Covva" },
          publisher: { "@type": "Organization", name: "Covva", logo: { "@type": "ImageObject", url: `${siteUrl()}/icon-512.png` } },
          articleSection: a.topic,
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
          <div className="mt-8 max-w-3xl"><LanguageSwitcher /></div>
        </Container>
      </div>

      <Container className="py-10 sm:py-14">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <article className="max-w-3xl">
            {a.body.map((b, i) => <Block key={i} b={b} />)}
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
          </aside>
        </div>
      </Container>

      <CtaBand title="Ready to compare?" body="Get indicative quotes in minutes from participating licensed insurers." primary={{ label: "Get quotes", href: "/#quote" }} secondary={{ label: "More guides", href: "/learn" }} />
    </>
  );
}
