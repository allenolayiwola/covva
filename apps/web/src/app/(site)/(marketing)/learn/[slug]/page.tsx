import { sitePath } from "@/lib/site-url";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ARTICLES } from "@/components/marketing/articles";
import { ArticleBody, moreGuides } from "@/components/marketing/article-page";
import { getArticle, getArticles } from "@/server/cms";

/**
 * Learn article (English). Content comes from the CMS when it has published articles, otherwise
 * from the typed list; the typed slugs are prerendered, CMS-only slugs render on first request.
 * No Suspense fallback: a skeleton in the static shell painted with the footer on screen, then the
 * swap to real content pushed the footer down (layout shift). `instant = false` lets the segment
 * block on the (cached) CMS read instead, as /learn/[slug]/[lang] does.
 */
export const instant = false;

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) return { title: "Article not found", robots: { index: false } };
  const title = a.seo.title ?? a.title;
  const description = a.seo.description ?? a.summary;
  return {
    title,
    description,
    alternates: { canonical: `/learn/${a.slug}`, languages: Object.fromEntries(a.availableLocales.filter((l) => l !== "en").map((l) => [l, `/learn/${a.slug}/${l}`])) },
    robots: a.seo.noIndex ? { index: false, follow: false } : undefined,
    openGraph: { type: "article", title, description, url: `/learn/${a.slug}`, publishedTime: a.published, modifiedTime: a.updated ?? a.published, images: [a.coverImage?.url ?? sitePath("/opengraph-image")] },
  };
}

export default async function ArticlePage({ params }: PageProps<"/learn/[slug]">) {
  const { slug } = await params;
  const [a, all] = await Promise.all([getArticle(slug), getArticles()]);
  if (!a) notFound();
  return <ArticleBody article={a} others={moreGuides(a, all)} locale="en" />;
}
