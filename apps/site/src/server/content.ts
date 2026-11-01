import "server-only";
import { simpleBlocksToRichNodes, type CmsLocale, type RichNode } from "@im/core";
import { ARTICLES, type Article } from "@/components/marketing/articles";
import { FAQ_GROUPS, HOME_FAQ_IDS, TESTIMONIALS, findFaq, type FaqGroup, type FaqItem } from "@/components/marketing/content";

/**
 * Marketing content readers. The content lives in code (components/marketing/articles.ts and content.ts);
 * these readers shape it for the pages. They are async so a future content source can slot in without
 * changing the pages.
 */

const CLAIMS_FAQ_IDS = ["how-claim", "who-decides", "declined"];

/* ----------------------------------------------------------------------------
 * Learn articles
 * ------------------------------------------------------------------------- */

export interface ImageView { url: string; alt: string; width: number | null; height: number | null }

export interface ArticleView {
  slug: string;
  title: string;
  summary: string;
  topic: string;
  readMinutes: number;
  author: string;
  /** ISO date (YYYY-MM-DD). */
  published: string;
  updated?: string;
  related: { href: string; label: string }[];
  relatedArticles: { slug: string; title: string }[];
  body: RichNode[];
  coverImage: ImageView | null;
  seo: { title?: string; description?: string; noIndex: boolean };
  locale: CmsLocale;
  /** False when `locale` has no translation and the English text is shown instead. */
  translated: boolean;
  availableLocales: CmsLocale[];
}

function toView(a: Article): ArticleView {
  return {
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    topic: a.topic,
    readMinutes: a.readMinutes,
    author: "Covva",
    published: a.published,
    updated: a.updated,
    related: a.related,
    relatedArticles: [],
    body: simpleBlocksToRichNodes(a.body),
    coverImage: null,
    seo: { noIndex: false },
    locale: "en",
    translated: true,
    availableLocales: ["en"],
  };
}

/** Learn hub list. */
export async function getArticles(): Promise<ArticleView[]> {
  return ARTICLES.map(toView);
}

export async function getArticle(slug: string): Promise<ArticleView | null> {
  const a = ARTICLES.find((x) => x.slug === slug);
  return a ? toView(a) : null;
}

/** Languages with translated articles (drives the Learn hub language switcher). English only for now. */
export async function getArticleLocales(): Promise<CmsLocale[]> {
  return ["en"];
}

/* ----------------------------------------------------------------------------
 * FAQs and testimonials
 * ------------------------------------------------------------------------- */

/** Help-centre FAQ groups. */
export async function getFaqGroups(): Promise<FaqGroup[]> {
  return FAQ_GROUPS;
}

/** FAQs for the home page or the claims page. */
export async function getFaqsFor(placement: "home" | "claims"): Promise<FaqItem[]> {
  return findFaq(placement === "home" ? HOME_FAQ_IDS : CLAIMS_FAQ_IDS);
}

export interface TestimonialView { id: string; quote: string; name: string; context: string; illustrative: boolean }

export async function getTestimonials(): Promise<TestimonialView[]> {
  return TESTIMONIALS.map((t) => ({ ...t, illustrative: t.illustrative !== false }));
}
