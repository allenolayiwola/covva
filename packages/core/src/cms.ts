/**
 * Pure helpers for the marketing CMS (Payload). Nothing here imports Payload or Next: these rules
 * are shared by the Payload config (validation), the seed script (conversion of today's typed
 * content) and the site (safe rendering + fallbacks), and are unit-tested with node:test.
 *
 * Covva is a technology platform. It is never an insurer or a broker, and never holds premiums.
 * `findProhibitedClaims` stops copy that says otherwise from being saved.
 */

/* ----------------------------------------------------------------------------
 * Locales
 * ------------------------------------------------------------------------- */

/** CMS locale codes. They match the site's `LOCALES` (`gaa` is ISO 639-3 for Ga; `ga` is Irish). */
export const CMS_LOCALES = [
  { code: "en", label: "English" },
  { code: "tw", label: "Twi" },
  { code: "gaa", label: "Ga" },
  { code: "ee", label: "Ewe" },
] as const;
export type CmsLocale = (typeof CMS_LOCALES)[number]["code"];
export const CMS_DEFAULT_LOCALE: CmsLocale = "en";

export function isCmsLocale(value: unknown): value is CmsLocale {
  return typeof value === "string" && CMS_LOCALES.some((l) => l.code === value);
}

/* ----------------------------------------------------------------------------
 * Slugs
 * ------------------------------------------------------------------------- */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lower-case words joined by single hyphens, 1–96 chars. */
export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 96 && SLUG_RE.test(value);
}

/**
 * First path segments the web app already serves. A CMS page may not take one of these: the
 * static route would win anyway, so the editor would publish a page nobody can reach.
 */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  "about", "account", "api", "auth", "brokers", "bundles", "business", "claims", "cms", "cms-api", "consent", "contact",
  "diaspora", "embed", "explore", "get-started", "how-it-works", "insurance", "insurers", "learn", "legal", "micro",
  "onboarding", "pages", "partner", "partners", "press", "q", "quote", "referrals", "sign-in", "sign-up", "sign-out", "support",
  "trust", "verify", "waitlist", "sitemap.xml", "robots.txt", "manifest.webmanifest", "opengraph-image", "icon.svg",
];

/** Payload-style validator: `true` when OK, otherwise the message to show the editor. */
export function validatePageSlug(value: unknown): true | string {
  if (!isValidSlug(value)) return "Use lower-case letters, digits and hyphens only (for example: diaspora-care-pack).";
  if (RESERVED_PAGE_SLUGS.includes(value)) return `"${value}" is a route the site already serves. Choose another slug.`;
  return true;
}

/* ----------------------------------------------------------------------------
 * Compliance copy
 * ------------------------------------------------------------------------- */

const BRAND = "covva";
/** "Covva is a broker", "Covva, a licensed insurer", "we are your broker", "our underwriters" … */
const CLAIM_RE = new RegExp(
  `\\b(?:${BRAND}|we)\\b[^.!?\\n]{0,40}?\\b(?:is|are|as|be|become|acts?\\s+as|operates?\\s+as)\\s+(?:an?\\s+|your\\s+|the\\s+)?(?:licensed\\s+|registered\\s+|nic[- ]licensed\\s+|insurance\\s+)?(?:insurer|broker|underwriter|insurance\\s+company)s?\\b`,
  "gi",
);
const NEGATED_RE = /\b(?:not|never|neither|nor|no|isn['’]?t|aren['’]?t|rather\s+than|instead\s+of)\b/i;
const HOLDS_RE = /\b(?:we|covva)\b[^.!?\n]{0,30}?\b(?:holds?|keeps?|collects?|receives?)\s+(?:your\s+|the\s+|customers?['’]?\s+)?(?:premium|premiums|money|funds|payment)s?\b/gi;

export interface ProhibitedClaim { text: string; index: number; reason: "role" | "funds" }

/**
 * Find sentences that describe Covva as an insurer or broker, or as holding client money.
 * Negated statements ("Covva is not an insurer or a broker") are allowed; those are the ones we want.
 */
export function findProhibitedClaims(text: string | null | undefined): ProhibitedClaim[] {
  if (!text) return [];
  const out: ProhibitedClaim[] = [];
  for (const [re, reason] of [[CLAIM_RE, "role"], [HOLDS_RE, "funds"]] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const window = text.slice(Math.max(0, m.index - 40), m.index + m[0].length);
      if (!NEGATED_RE.test(window)) out.push({ text: m[0], index: m.index, reason });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Payload-style validator for text fields: rejects copy that misstates Covva's role. */
export function validateCompliantCopy(value: unknown): true | string {
  const text = typeof value === "string" ? value : richTextToPlainText(value as RichTextRoot | null);
  const hit = findProhibitedClaims(text)[0];
  if (!hit) return true;
  return hit.reason === "funds"
    ? `"${hit.text}" — Covva never holds premiums or client money; payment goes to the insurer through an authorised provider. Reword this.`
    : `"${hit.text}" — Covva is a technology platform, not an insurer or a broker. Reword this (licensed brokers advise, licensed insurers underwrite).`;
}

/** A testimonial may be published as genuine only with consent on file; otherwise it must be marked illustrative. */
export function testimonialPublishable(t: { illustrative?: boolean | null; consentOnFile?: boolean | null }): true | string {
  if (t.illustrative) return true;
  if (t.consentOnFile) return true;
  return "Tick “Consent on file” (the customer agreed in writing to be quoted) or mark the testimonial as illustrative.";
}

export interface TestimonialFlags {
  illustrative?: boolean | null;
  consentOnFile?: boolean | null;
}

/** Collection defaults for the two flags (a new testimonial is illustrative until an editor says otherwise). */
export const TESTIMONIAL_FLAG_DEFAULTS: Readonly<Required<{ [K in keyof TestimonialFlags]: boolean }>> = Object.freeze({ illustrative: true, consentOnFile: false });

/**
 * The flags a testimonial will have after a write: the incoming `data` (a full document on create,
 * possibly a partial one on update) merged over the stored `originalDoc`. A flag the request does
 * not mention (`undefined` or `null`) keeps its stored value, so a PATCH that only edits the quote
 * is judged on the real document; an explicit `false` is kept as `false`. With neither source the
 * collection defaults apply.
 */
export function mergeTestimonialFlags(data?: TestimonialFlags | null, originalDoc?: TestimonialFlags | null): { illustrative: boolean; consentOnFile: boolean } {
  const pick = (key: keyof TestimonialFlags): boolean => {
    const incoming = data?.[key];
    if (incoming !== undefined && incoming !== null) return Boolean(incoming);
    const stored = originalDoc?.[key];
    if (stored !== undefined && stored !== null) return Boolean(stored);
    return TESTIMONIAL_FLAG_DEFAULTS[key];
  };
  return { illustrative: pick("illustrative"), consentOnFile: pick("consentOnFile") };
}

/* ----------------------------------------------------------------------------
 * Rich text: Lexical JSON → a small safe node tree
 * ------------------------------------------------------------------------- */

/** Simple typed blocks used by the hard-coded Learn articles (kept for the seed and the fallback). */
export type SimpleContentBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "tip"; text: string };

/** What the site renders. Deliberately small: no raw HTML, no unknown tags, links are vetted. */
export type RichNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 2 | 3 | 4; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "quote"; children: InlineNode[] }
  | { type: "tip"; text: string }
  | { type: "rule" };

export type InlineNode =
  | { type: "text"; text: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { type: "link"; href: string; newTab?: boolean; children: InlineNode[] }
  | { type: "break" };

/** Loose shape of a Lexical editor state as Payload stores it. Only the fields we read. */
export interface LexicalNode {
  type?: string;
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  children?: LexicalNode[];
  fields?: Record<string, unknown> | null;
  [key: string]: unknown;
}
export interface RichTextRoot { root?: LexicalNode | null }

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_CODE = 16;

/** Allow http(s), mailto, tel and same-site relative links; drop anything else (javascript:, data:, …). */
export function safeHref(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const href = input.trim();
  if (!href || /[\u0000-\u001f\s]/.test(href)) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(href)) return href;
  return null;
}

function inlineFromLexical(node: LexicalNode): InlineNode[] {
  switch (node.type) {
    case "text": {
      const f = typeof node.format === "number" ? node.format : 0;
      const text = typeof node.text === "string" ? node.text : "";
      if (!text) return [];
      return [{ type: "text", text, ...(f & FORMAT_BOLD ? { bold: true } : {}), ...(f & FORMAT_ITALIC ? { italic: true } : {}), ...(f & FORMAT_CODE ? { code: true } : {}) }];
    }
    case "linebreak":
      return [{ type: "break" }];
    case "link":
    case "autolink": {
      const fields = (node.fields ?? {}) as { url?: unknown; newTab?: unknown; linkType?: unknown; doc?: unknown };
      const children = (node.children ?? []).flatMap(inlineFromLexical);
      let href = safeHref(fields.url);
      if (fields.linkType === "internal" && fields.doc && typeof fields.doc === "object") {
        const doc = fields.doc as { relationTo?: string; value?: { slug?: string } | string };
        const slug = typeof doc.value === "object" && doc.value ? doc.value.slug : undefined;
        if (slug && isValidSlug(slug)) href = doc.relationTo === "articles" ? `/learn/${slug}` : `/pages/${slug}`;
      }
      if (!href) return children;
      return [{ type: "link", href, ...(fields.newTab ? { newTab: true } : {}), children }];
    }
    default:
      // Unknown inline (mentions, uploads inline, …): keep its text content only.
      return (node.children ?? []).flatMap(inlineFromLexical);
  }
}

function listItems(node: LexicalNode): InlineNode[][] {
  const items: InlineNode[][] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "listitem") continue;
    const inline: InlineNode[] = [];
    for (const grand of child.children ?? []) {
      // Nested lists are flattened into the parent item's text (the site has no nested-list style).
      if (grand.type === "list") {
        for (const nested of listItems(grand)) inline.push({ type: "break" }, ...nested);
      } else inline.push(...inlineFromLexical(grand));
    }
    if (inline.length) items.push(inline);
  }
  return items;
}

/** Convert a Payload/Lexical editor state to `RichNode[]`. Unknown block types are dropped, never passed through. */
export function lexicalToRichNodes(state: RichTextRoot | null | undefined): RichNode[] {
  const root = state?.root;
  if (!root || !Array.isArray(root.children)) return [];
  const out: RichNode[] = [];
  for (const node of root.children) {
    switch (node.type) {
      case "paragraph": {
        const children = (node.children ?? []).flatMap(inlineFromLexical);
        if (children.some((c) => c.type !== "break")) out.push({ type: "paragraph", children });
        break;
      }
      case "heading": {
        const tag = typeof node.tag === "string" ? node.tag : "h2";
        const level = tag === "h3" ? 3 : tag === "h4" ? 4 : 2;
        const children = (node.children ?? []).flatMap(inlineFromLexical);
        if (children.length) out.push({ type: "heading", level, children });
        break;
      }
      case "list": {
        const items = listItems(node);
        if (items.length) out.push({ type: "list", ordered: node.listType === "number", items });
        break;
      }
      case "quote": {
        const children = (node.children ?? []).flatMap(inlineFromLexical);
        if (children.length) out.push({ type: "quote", children });
        break;
      }
      case "horizontalrule":
        out.push({ type: "rule" });
        break;
      case "block": {
        const fields = (node.fields ?? {}) as { blockType?: unknown; text?: unknown };
        if (fields.blockType === "tip" && typeof fields.text === "string" && fields.text.trim()) out.push({ type: "tip", text: fields.text.trim() });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.text : n.type === "break" ? "\n" : inlineToPlainText(n.children)))
    .join("");
}

/** Plain text of a rich-text tree (search, JSON-LD descriptions, reading time). */
export function richNodesToPlainText(nodes: RichNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "paragraph":
        case "heading":
        case "quote":
          return inlineToPlainText(n.children);
        case "list":
          return n.items.map(inlineToPlainText).join("\n");
        case "tip":
          return n.text;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

export function richTextToPlainText(state: RichTextRoot | null | undefined): string {
  return richNodesToPlainText(lexicalToRichNodes(state));
}

/** Reading time at ~200 words a minute, at least 1 minute. */
export function estimateReadMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/* ----------------------------------------------------------------------------
 * Conversions between the typed blocks and rich text (seed + fallback)
 * ------------------------------------------------------------------------- */

export function simpleBlocksToRichNodes(blocks: SimpleContentBlock[]): RichNode[] {
  return blocks.map((b): RichNode => {
    switch (b.type) {
      case "h2":
        return { type: "heading", level: 2, children: [{ type: "text", text: b.text }] };
      case "ul":
        return { type: "list", ordered: false, items: b.items.map((t) => [{ type: "text", text: t }]) };
      case "ol":
        return { type: "list", ordered: true, items: b.items.map((t) => [{ type: "text", text: t }]) };
      case "tip":
        return { type: "tip", text: b.text };
      default:
        return { type: "paragraph", children: [{ type: "text", text: b.text }] };
    }
  });
}

const lexicalText = (text: string): LexicalNode => ({ type: "text", text, detail: 0, format: 0, mode: "normal", style: "", version: 1 });
const lexicalBlock = (node: Record<string, unknown>): LexicalNode => ({ direction: "ltr", format: "", indent: 0, version: 1, ...node });

/** Build a Lexical editor state (what Payload stores) from the typed blocks. Used by the seed. */
export function simpleBlocksToLexical(blocks: SimpleContentBlock[]): RichTextRoot {
  const children: LexicalNode[] = blocks.map((b) => {
    switch (b.type) {
      case "h2":
        return lexicalBlock({ type: "heading", tag: "h2", children: [lexicalText(b.text)] });
      case "ul":
      case "ol":
        return lexicalBlock({
          type: "list",
          listType: b.type === "ol" ? "number" : "bullet",
          tag: b.type,
          start: 1,
          children: b.items.map((item, i) => lexicalBlock({ type: "listitem", value: i + 1, children: [lexicalText(item)] })),
        });
      case "tip":
        return { type: "block", format: "", version: 2, fields: { blockType: "tip", blockName: "", text: b.text } };
      default:
        return lexicalBlock({ type: "paragraph", textFormat: 0, textStyle: "", children: [lexicalText(b.text)] });
    }
  });
  return { root: lexicalBlock({ type: "root", children }) };
}

/* ----------------------------------------------------------------------------
 * Fallbacks and ordering
 * ------------------------------------------------------------------------- */

/** Use CMS content when it exists and has at least one item; otherwise today's typed content. */
export function preferCms<T>(cms: readonly T[] | null | undefined, fallback: readonly T[]): { items: T[]; source: "cms" | "code" } {
  return cms && cms.length > 0 ? { items: [...cms], source: "cms" } : { items: [...fallback], source: "code" };
}

/** Stable sort by `order` (nulls last) then by a secondary key. */
export function sortByOrder<T extends { order?: number | null }>(items: readonly T[], secondary?: (t: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return secondary ? secondary(a).localeCompare(secondary(b)) : 0;
  });
}

/** Group flat FAQ rows into ordered groups, keeping only categories that have items. */
export function groupFaqs<T extends { category: string; order?: number | null }>(
  items: readonly T[],
  categories: readonly { id: string; title: string }[],
): { id: string; title: string; items: T[] }[] {
  const byCategory = new Map<string, T[]>();
  for (const it of sortByOrder(items)) {
    const list = byCategory.get(it.category) ?? [];
    list.push(it);
    byCategory.set(it.category, list);
  }
  const out: { id: string; title: string; items: T[] }[] = [];
  for (const c of categories) {
    const list = byCategory.get(c.id);
    if (list?.length) out.push({ id: c.id, title: c.title, items: list });
  }
  for (const [id, list] of byCategory) {
    if (!categories.some((c) => c.id === id)) out.push({ id, title: id, items: list });
  }
  return out;
}

/** FAQ categories (match today's help-centre groups). */
export const FAQ_CATEGORIES = [
  { id: "quotes", title: "Getting quotes" },
  { id: "paying", title: "Paying" },
  { id: "policies", title: "Policies & documents" },
  { id: "renewals", title: "Renewals" },
  { id: "claims", title: "Claims" },
  { id: "complaints", title: "Complaints" },
  { id: "account", title: "Account & privacy" },
] as const;

/** Learn hub topics. */
export const ARTICLE_TOPICS = ["Motor", "Claims", "Diaspora", "Basics", "Renewals"] as const;

/** Places a FAQ can be shown besides the help centre. */
export const FAQ_PLACEMENTS = [
  { id: "support", label: "Help centre (/support)" },
  { id: "home", label: "Home page" },
  { id: "claims", label: "Claims page" },
] as const;

/** Partner types for the logo strip. */
export const PARTNER_TYPES = [
  { id: "insurer", label: "Insurer" },
  { id: "broker", label: "Broker" },
  { id: "payment", label: "Payment provider" },
] as const;
