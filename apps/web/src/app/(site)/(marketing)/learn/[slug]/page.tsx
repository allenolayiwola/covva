import { sitePath } from "@/lib/site-url";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ARTICLES } from "@/components/marketing/articles";
import { ArticleBody, moreGuides } from "@/components/marketing/article-page";
import { getArticle, getArticles } from "@/server/content";

/**
 * Learn article. Every slug is prerendered from the articles in code; unknown slugs get a real 404 from the
 * proxy. No Suspense fallback: a skeleton in the static shell painted with the footer on screen, then the swap
 * to real content pushed the footer down (layout shift).
 */
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
    alternates: { canonical: `/learn/${a.slug}` },
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
