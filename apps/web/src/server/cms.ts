import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { draftMode } from "next/headers";
import type { Payload, Where } from "payload";
import {
  CMS_DEFAULT_LOCALE,
  FAQ_CATEGORIES,
  groupFaqs,
  isCmsLocale,
  lexicalToRichNodes,
  preferCms,
  safeHref,
  simpleBlocksToRichNodes,
  sortByOrder,
  type CmsLocale,
  type RichNode,
  type RichTextRoot,
} from "@im/core";
import { ARTICLES, type Article } from "@/components/marketing/articles";
import { FAQ_GROUPS, HOME_FAQ_IDS, TESTIMONIALS, findFaq, type FaqGroup, type FaqItem } from "@/components/marketing/content";
import { cmsConfigured } from "@/cms/env";
import type { Article as CmsArticle, Faq as CmsFaq, Media as CmsMedia, Page as CmsPage, Partner as CmsPartner, Testimonial as CmsTestimonial } from "@/cms/payload-types";
import { log } from "@/server/log";

/**
 * Site-side readers for the marketing CMS (docs/CMS.md).
 *
 * Every reader is a `'use cache'` function tagged `cms` + `cms:<collection>`: publishing in the
 * admin calls `revalidateTag` on those tags. When the CMS is not configured, unreachable, or has
 * no published content for a section, the reader returns today's typed content, so the site
 * renders exactly as before the CMS existed. Draft mode (editor preview) reads unpublished
 * versions and bypasses the cache (Next re-executes cached scopes while draft mode is on).
 *
 * Payload is loaded lazily, so a server without the CMS never imports it.
 */

/* ----------------------------------------------------------------------------
 * Shared
 * ------------------------------------------------------------------------- */

const CLAIMS_FAQ_IDS = ["how-claim", "who-decides", "declined"];

/** A localized field read with `locale: "all"`: a map of locale → value. */
type Localized<T> = T | Partial<Record<string, T>> | null | undefined;

function isLocaleMap(v: unknown): v is Partial<Record<string, unknown>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if ("root" in (v as object)) return false; // a rich-text value
  return Object.keys(v as object).every((k) => isCmsLocale(k));
}

/** Pick `locale`, falling back to English, from a value read with `locale: "all"`. */
function pick<T>(v: Localized<T>, locale: CmsLocale): { value: T | undefined; translated: boolean } {
  if (isLocaleMap(v)) {
    const m = v as Partial<Record<string, T>>;
    const own = m[locale];
    const present = own !== undefined && own !== null && (typeof own !== "string" || own.trim() !== "");
    if (present) return { value: own as T, translated: true };
    return { value: m[CMS_DEFAULT_LOCALE] ?? undefined, translated: locale === CMS_DEFAULT_LOCALE };
  }
  return { value: (v ?? undefined) as T | undefined, translated: locale === CMS_DEFAULT_LOCALE };
}

function text(v: Localized<string>, locale: CmsLocale): string {
  return pick(v, locale).value ?? "";
}

/** Locales in which a localized text value is present. */
function localesOf(v: Localized<string>): CmsLocale[] {
  if (!isLocaleMap(v)) return [CMS_DEFAULT_LOCALE];
  return Object.entries(v as Partial<Record<string, string>>)
    .filter(([k, val]) => isCmsLocale(k) && typeof val === "string" && val.trim() !== "")
    .map(([k]) => k as CmsLocale);
}

async function withPayload<T>(fn: (payload: Payload, draft: boolean) => Promise<T>): Promise<T | null> {
  if (!cmsConfigured()) return null;
  try {
    const { isEnabled } = await draftMode();
    const { getPayloadClient } = await import("@/cms/client");
    const payload = await getPayloadClient();
    return await fn(payload, isEnabled);
  } catch (err) {
    log.warn("cms.unavailable", { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

const published = (draft: boolean): Where => (draft ? {} : { _status: { equals: "published" } });

export interface ImageView { url: string; alt: string; width: number | null; height: number | null }

function image(v: number | CmsMedia | null | undefined, locale: CmsLocale): ImageView | null {
  if (!v || typeof v !== "object" || !v.url) return null;
  const url = safeHref(v.url);
  if (!url) return null;
  return { url, alt: text(v.alt as Localized<string>, locale), width: v.width ?? null, height: v.height ?? null };
}

/* ----------------------------------------------------------------------------
 * Learn articles
 * ------------------------------------------------------------------------- */

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
  source: "cms" | "code";
}

function fromCodeArticle(a: Article): ArticleView {
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
    source: "code",
  };
}

function fromCmsArticle(doc: CmsArticle, locale: CmsLocale): ArticleView {
  const title = pick(doc.title as Localized<string>, locale);
  const body = pick(doc.body as Localized<RichTextRoot>, locale);
  const related = (doc.related ?? [])
    .map((r) => ({ href: safeHref(r.href) ?? "", label: text(r.label as Localized<string>, locale) }))
    .filter((r) => r.href && r.label);
  const relatedArticles = (doc.relatedArticles ?? [])
    .map((r) => (typeof r === "object" && r ? { slug: r.slug, title: text(r.title as Localized<string>, locale) } : null))
    .filter((r): r is { slug: string; title: string } => !!r && !!r.slug);
  const publishedAt = doc.publishedAt?.slice(0, 10) ?? doc.createdAt.slice(0, 10);
  const updatedAt = doc.updatedAt.slice(0, 10);
  return {
    slug: doc.slug,
    title: title.value ?? "",
    summary: text(doc.summary as Localized<string>, locale),
    topic: doc.topic,
    readMinutes: doc.readMinutes ?? 3,
    author: doc.author || "Covva",
    published: publishedAt,
    updated: updatedAt > publishedAt ? updatedAt : undefined,
    related,
    relatedArticles,
    body: lexicalToRichNodes(body.value ?? null),
    coverImage: image(doc.coverImage, locale),
    seo: {
      title: text(doc.seo?.title as Localized<string>, locale) || undefined,
      description: text(doc.seo?.description as Localized<string>, locale) || undefined,
      noIndex: Boolean(doc.seo?.noIndex),
    },
    locale,
    translated: title.translated && body.translated,
    availableLocales: localesOf(doc.title as Localized<string>),
    source: "cms",
  };
}

async function fetchCmsArticles(): Promise<CmsArticle[] | null> {
  return withPayload(async (payload, draft) => {
    const { docs } = await payload.find({ collection: "articles", where: published(draft), draft, locale: "all", depth: 1, limit: 200, sort: "-publishedAt", pagination: false });
    return docs;
  });
}

/** Learn hub list. CMS articles when any are published, otherwise the typed articles. */
export async function getArticles(locale: CmsLocale = "en"): Promise<ArticleView[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:articles", "cms:media");
  const cms = await fetchCmsArticles();
  if (cms && cms.length > 0) return cms.map((d) => fromCmsArticle(d, locale));
  return ARTICLES.map(fromCodeArticle);
}

export async function getArticle(slug: string, locale: CmsLocale = "en"): Promise<ArticleView | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:articles", "cms:media", `cms:article:${slug}`);
  const cms = await fetchCmsArticles();
  if (cms && cms.length > 0) {
    const doc = cms.find((d) => d.slug === slug);
    return doc ? fromCmsArticle(doc, locale) : null;
  }
  const a = ARTICLES.find((x) => x.slug === slug);
  return a ? { ...fromCodeArticle(a), locale, translated: locale === "en" } : null;
}

/** Locales that have at least one translated article (drives the Learn hub language switcher). */
export async function getArticleLocales(): Promise<CmsLocale[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:articles");
  const cms = await fetchCmsArticles();
  const set = new Set<CmsLocale>(["en"]);
  for (const d of cms ?? []) for (const l of localesOf(d.title as Localized<string>)) set.add(l);
  return [...set];
}

/* ----------------------------------------------------------------------------
 * FAQs
 * ------------------------------------------------------------------------- */

type FaqRow = FaqItem & { category: string; order: number | null; placements: string[] };

async function fetchCmsFaqs(): Promise<FaqRow[] | null> {
  return withPayload(async (payload, draft) => {
    const { docs } = await payload.find({ collection: "faqs", where: published(draft), draft, locale: "all", depth: 0, limit: 500, pagination: false, sort: "order" });
    return docs.map((d: CmsFaq) => ({
      id: d.key,
      q: text(d.question as Localized<string>, "en"),
      a: text(d.answer as Localized<string>, "en"),
      category: d.category,
      order: d.order ?? null,
      placements: d.placements ?? ["support"],
    }));
  });
}

/** Help-centre groups: every published CMS FAQ grouped by category, else today's groups. */
export async function getFaqGroups(): Promise<FaqGroup[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:faqs");
  const cms = await fetchCmsFaqs();
  if (!cms || cms.length === 0) return FAQ_GROUPS;
  return groupFaqs(cms, FAQ_CATEGORIES).map((g) => ({ id: g.id, title: g.title, items: g.items.map(({ id, q, a }) => ({ id, q, a })) }));
}

/** FAQs for another placement (home page, claims page), in editor order. */
export async function getFaqsFor(placement: "home" | "claims"): Promise<FaqItem[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:faqs");
  const cms = await fetchCmsFaqs();
  if (cms && cms.length > 0) {
    const picked = sortByOrder(cms.filter((f) => f.placements.includes(placement)), (f) => f.q).map(({ id, q, a }) => ({ id, q, a }));
    if (picked.length > 0) return picked;
  }
  return findFaq(placement === "home" ? HOME_FAQ_IDS : CLAIMS_FAQ_IDS);
}

/* ----------------------------------------------------------------------------
 * Testimonials
 * ------------------------------------------------------------------------- */

export interface TestimonialView { id: string; quote: string; name: string; context: string; illustrative: boolean }

export async function getTestimonials(): Promise<TestimonialView[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:testimonials");
  const cms = await withPayload(async (payload, draft) => {
    const { docs } = await payload.find({ collection: "testimonials", where: published(draft), draft, locale: "all", depth: 0, limit: 50, pagination: false, sort: "order" });
    return docs.map((d: CmsTestimonial): TestimonialView => ({
      id: d.key,
      quote: text(d.quote as Localized<string>, "en"),
      name: d.name,
      context: d.context,
      // Only a quote with written consent on file may lose the label; the collection enforces it on save.
      illustrative: d.illustrative !== false || !d.consentOnFile,
    }));
  });
  return preferCms(cms, TESTIMONIALS).items.map((t) => ({ ...t, illustrative: t.illustrative !== false }));
}

/* ----------------------------------------------------------------------------
 * Partners (logo strip)
 * ------------------------------------------------------------------------- */

export interface PartnerView {
  slug: string;
  name: string;
  type: "insurer" | "broker" | "payment";
  logo: ImageView | null;
  url: string | null;
  brandColor: string | null;
  licenceNumber: string | null;
}

/** Published partners marked "show on site", in display order. `null` when the CMS has none. */
export async function getPartners(): Promise<PartnerView[] | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:partners", "cms:media");
  const cms = await withPayload(async (payload, draft) => {
    const where: Where = { and: [published(draft), { showOnSite: { equals: true } }] };
    const { docs } = await payload.find({ collection: "partners", where, draft, locale: "all", depth: 1, limit: 100, pagination: false, sort: "order" });
    return docs.map((d: CmsPartner): PartnerView => ({
      slug: d.slug,
      name: d.name,
      type: d.type,
      logo: image(d.logo, "en"),
      url: safeHref(d.url),
      brandColor: d.brandColor ?? null,
      licenceNumber: d.licenceNumber ?? null,
    }));
  });
  return cms && cms.length > 0 ? cms : null;
}

/* ----------------------------------------------------------------------------
 * Pages (block-built landing pages at /<slug>)
 * ------------------------------------------------------------------------- */

export interface LinkView { label: string; href: string }

export type PageBlockView =
  | { type: "hero"; id: string; eyebrow: string | null; title: string; lede: string | null; primary: LinkView | null; secondary: LinkView | null }
  | { type: "richText"; id: string; content: RichNode[] }
  | { type: "faqList"; id: string; heading: string | null; items: FaqItem[] }
  | { type: "ctaBand"; id: string; title: string; body: string | null; primary: LinkView; secondary: LinkView | null }
  | { type: "partnerStrip"; id: string; heading: string; types: PartnerView["type"][] }
  | { type: "testimonialStrip"; id: string; heading: string | null; items: TestimonialView[] };

export interface PageView {
  slug: string;
  title: string;
  blocks: PageBlockView[];
  seo: { title?: string; description?: string; noIndex: boolean };
  updated: string;
  locale: CmsLocale;
  translated: boolean;
  availableLocales: CmsLocale[];
}

function link(v: { label?: string | null; href?: string | null } | null | undefined, locale: CmsLocale): LinkView | null {
  const href = safeHref(v?.href);
  const label = text(v?.label as Localized<string>, locale);
  return href && label ? { label, href } : null;
}

function fromCmsPage(doc: CmsPage, allFaqs: FaqRow[], testimonials: TestimonialView[], locale: CmsLocale): PageView {
  const title = pick(doc.title as Localized<string>, locale);
  let translated = title.translated;
  const blocks: PageBlockView[] = [];
  for (const b of doc.layout ?? []) {
    const id = b.id ?? `${b.blockType}-${blocks.length}`;
    switch (b.blockType) {
      case "hero":
        blocks.push({ type: "hero", id, eyebrow: text(b.eyebrow as Localized<string>, locale) || null, title: text(b.title as Localized<string>, locale), lede: text(b.lede as Localized<string>, locale) || null, primary: link(b.primary, locale), secondary: link(b.secondary, locale) });
        break;
      case "richText": {
        const content = pick(b.content as Localized<RichTextRoot>, locale);
        translated &&= content.translated;
        blocks.push({ type: "richText", id, content: lexicalToRichNodes(content.value ?? null) });
        break;
      }
      case "faqList": {
        const chosen = (b.faqs ?? []).map((f) => (typeof f === "object" && f ? f.key : null)).filter((k): k is string => !!k);
        const items = chosen.length > 0 ? chosen.map((k) => allFaqs.find((f) => f.id === k)).filter((f): f is FaqRow => !!f) : b.category ? allFaqs.filter((f) => f.category === b.category) : [];
        blocks.push({ type: "faqList", id, heading: text(b.heading as Localized<string>, locale) || null, items: items.map(({ id: fid, q, a }) => ({ id: fid, q, a })) });
        break;
      }
      case "ctaBand": {
        const primary = link(b.primary, locale);
        if (!primary) break;
        blocks.push({ type: "ctaBand", id, title: text(b.title as Localized<string>, locale), body: text(b.body as Localized<string>, locale) || null, primary, secondary: link(b.secondary, locale) });
        break;
      }
      case "partnerStrip":
        blocks.push({ type: "partnerStrip", id, heading: text(b.heading as Localized<string>, locale) || "Licensed partners only", types: (b.types ?? ["insurer", "broker"]) as PartnerView["type"][] });
        break;
      case "testimonialStrip": {
        const chosen = (b.testimonials ?? []).map((t) => (typeof t === "object" && t ? t.key : null)).filter((k): k is string => !!k);
        const items = chosen.length > 0 ? chosen.map((k) => testimonials.find((t) => t.id === k)).filter((t): t is TestimonialView => !!t) : testimonials;
        blocks.push({ type: "testimonialStrip", id, heading: text(b.heading as Localized<string>, locale) || null, items });
        break;
      }
    }
  }
  return {
    slug: doc.slug,
    title: title.value ?? "",
    blocks,
    seo: {
      title: text(doc.seo?.title as Localized<string>, locale) || undefined,
      description: text(doc.seo?.description as Localized<string>, locale) || undefined,
      noIndex: Boolean(doc.seo?.noIndex),
    },
    updated: doc.updatedAt.slice(0, 10),
    locale,
    translated,
    availableLocales: localesOf(doc.title as Localized<string>),
  };
}

export async function getPage(slug: string, locale: CmsLocale = "en"): Promise<PageView | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:pages", "cms:faqs", "cms:testimonials", "cms:media", `cms:page:${slug}`);
  const [doc, faqs, testimonials] = await Promise.all([
    withPayload(async (payload, draft) => {
      const where: Where = { and: [published(draft), { slug: { equals: slug } }] };
      const { docs } = await payload.find({ collection: "pages", where, draft, locale: "all", depth: 1, limit: 1 });
      return docs[0] ?? null;
    }),
    fetchCmsFaqs(),
    getTestimonials(),
  ]);
  return doc ? fromCmsPage(doc, faqs ?? [], testimonials, locale) : null;
}

/** Slugs of published pages (sitemap). */
export async function getPageSlugs(): Promise<{ slug: string; updated: string }[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("cms", "cms:pages");
  const rows = await withPayload(async (payload, draft) => {
    const { docs } = await payload.find({ collection: "pages", where: { and: [published(draft), { "seo.noIndex": { not_equals: true } }] }, draft, depth: 0, limit: 500, pagination: false, select: { slug: true, updatedAt: true } });
    return docs.map((d) => ({ slug: d.slug, updated: d.updatedAt.slice(0, 10) }));
  });
  return rows ?? [];
}
