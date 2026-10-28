import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isCmsLocale, localeDef, type CmsLocale } from "@im/core";
import { ArticleBody, moreGuides } from "@/components/marketing/article-page";
import { getArticle, getArticles } from "@/server/cms";

/**
 * Learn article in Twi (tw), Ga (gaa) or Ewe (ee): /learn/<slug>/<lang>. Rendered on request
 * (no static params), reading the CMS translation; a missing translation shows the English text
 * with a notice and keeps the English page as canonical, so nothing is machine-translated and
 * nothing untranslated is indexed as a translation. `instant = false`: params are read before
 * streaming so unknown slugs answer with a real 404 (reads are cached).
 */
export const instant = false;

function langOf(value: string): CmsLocale | null {
  return isCmsLocale(value) ? value : null;
}

export async function generateMetadata({ params }: PageProps<"/learn/[slug]/[lang]">): Promise<Metadata> {
  const { slug, lang } = await params;
  const locale = langOf(lang);
  const a = locale ? await getArticle(slug, locale) : null;
  if (!a || !locale) return { title: "Article not found", robots: { index: false } };
  const title = a.seo.title ?? a.title;
  const description = a.seo.description ?? a.summary;
  return {
    title,
    description,
    alternates: { canonical: a.translated ? `/learn/${a.slug}/${locale}` : `/learn/${a.slug}`, languages: { en: `/learn/${a.slug}` } },
    robots: a.seo.noIndex || !a.translated ? { index: false, follow: true } : undefined,
    openGraph: { type: "article", title, description, url: `/learn/${a.slug}/${locale}`, locale: localeDef(locale).htmlLang, publishedTime: a.published, modifiedTime: a.updated ?? a.published, images: [a.coverImage?.url ?? "/opengraph-image"] },
  };
}

export default async function TranslatedArticlePage({ params }: PageProps<"/learn/[slug]/[lang]">) {
  const { slug, lang } = await params;
  const locale = langOf(lang);
  if (!locale) notFound();
  if (locale === "en") redirect(`/learn/${slug}`);
  const [a, all] = await Promise.all([getArticle(slug, locale), getArticles(locale)]);
  if (!a) notFound();
  return <ArticleBody article={a} others={moreGuides(a, all)} locale={locale} />;
}
