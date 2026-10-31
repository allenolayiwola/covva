import { sitePath } from "@/lib/site-url";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidSlug } from "@im/core";
import { CmsPageBlocks } from "@/components/marketing/cms-page";
import { JsonLd } from "@/components/marketing/json-ld";
import { getPage, getPartners } from "@/server/cms";
import { siteUrl } from "@/lib/site-url";

/**
 * CMS pages at /pages/<slug> (block-built landing pages). Unknown slugs are a 404 rendered with the
 * marketing layout; with the CMS unconfigured every slug is a 404. Vanity top-level URLs can be
 * added as redirects in next.config.ts when marketing needs them. The route is partially prerendered,
 * so `notFound()` here can only stream a soft 404; the real 404 status for an unknown slug comes from the
 * proxy (src/proxy.ts, `cmsSlugMissing`), which checks the slug through /api/cms/exists before anything
 * streams. `instant = false`: the segment is allowed to block on the (cached) CMS read.
 */
export const instant = false;

function slugOf(value: string): string | null {
  return isValidSlug(value) ? value : null;
}

export async function generateMetadata({ params }: PageProps<"/pages/[slug]">): Promise<Metadata> {
  const slug = slugOf((await params).slug);
  const page = slug ? await getPage(slug) : null;
  if (!page) return { title: "Page not found", robots: { index: false } };
  const title = page.seo.title ?? page.title;
  const description = page.seo.description;
  return {
    title,
    description,
    alternates: { canonical: `/pages/${page.slug}` },
    robots: page.seo.noIndex ? { index: false, follow: false } : undefined,
    openGraph: { type: "website", title, description, url: `/pages/${page.slug}`, images: [sitePath("/opengraph-image")] },
  };
}

export default async function CmsPage({ params }: PageProps<"/pages/[slug]">) {
  const slug = slugOf((await params).slug);
  if (!slug) notFound();
  const [page, partners] = await Promise.all([getPage(slug), getPartners()]);
  if (!page) notFound();
  return (
    <>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", name: page.title, url: `${siteUrl()}/pages/${page.slug}`, dateModified: page.updated, inLanguage: "en-GH" }} />
      <CmsPageBlocks blocks={page.blocks} partners={partners} />
    </>
  );
}
