import type { CollectionConfig } from "payload";
import { ARTICLE_TOPICS, estimateReadMinutes, isValidSlug, richTextToPlainText, safeHref, validateCompliantCopy } from "@im/core";
import { publishedOrStaff, staff } from "../access";
import { EDITORIAL_NOTE, editor } from "../editor";
import { previewUrl, seoGroup } from "../fields/seo";
import { revalidateCollection } from "../hooks/revalidate";

/**
 * Learn hub (/learn). Written in English; Twi, Ga and Ewe tabs hold human translations only
 * (nothing is machine-translated). A locale with no translation shows the English text with a notice.
 */
export const Articles: CollectionConfig = {
  slug: "articles",
  labels: { singular: "Learn article", plural: "Learn articles" },
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "topic", "publishedAt", "_status", "updatedAt"],
    group: "Content",
    preview: previewUrl((doc) => (isValidSlug(doc.slug) ? `/learn/${doc.slug}` : null)),
    description: `Plain-language guides for /learn. General information, never advice about a reader's circumstances. ${EDITORIAL_NOTE}`,
  },
  access: { read: publishedOrStaff, create: staff, update: staff, delete: staff },
  versions: { drafts: { autosave: { interval: 2000 }, schedulePublish: true }, maxPerDoc: 25 },
  hooks: {
    ...revalidateCollection("articles"),
    beforeChange: [
      ({ data }) => {
        // Reading time from the English body when the editor leaves it empty.
        if (data && (!data.readMinutes || data.readMinutes < 1) && data.body) {
          data.readMinutes = estimateReadMinutes(richTextToPlainText(data.body));
        }
        return data;
      },
    ],
  },
  fields: [
    { name: "title", type: "text", required: true, localized: true, validate: validateCompliantCopy },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      validate: (v: unknown) => (isValidSlug(v) ? true : "Lower-case letters, digits and hyphens only (for example how-renewals-work)."),
      admin: { position: "sidebar", description: "The address: /learn/<slug>. Do not change after publishing (links and search results point to it)." },
    },
    { name: "summary", type: "textarea", required: true, localized: true, maxLength: 240, validate: validateCompliantCopy, admin: { description: "One or two sentences shown on the hub card and as the search description." } },
    { name: "topic", type: "select", required: true, options: ARTICLE_TOPICS.map((t) => ({ label: t, value: t })), admin: { position: "sidebar" } },
    { name: "author", type: "text", defaultValue: "Covva", admin: { position: "sidebar", description: "Shown in the article schema. \"Covva\" for team-written guides." } },
    { name: "readMinutes", type: "number", min: 1, max: 60, admin: { position: "sidebar", description: "Leave empty to calculate from the text." } },
    { name: "publishedAt", type: "date", required: true, defaultValue: () => new Date().toISOString(), admin: { position: "sidebar", date: { pickerAppearance: "dayOnly" } } },
    { name: "coverImage", type: "upload", relationTo: "media", admin: { description: "Optional. Shown as the social-sharing image." } },
    { name: "body", type: "richText", required: true, localized: true, editor, validate: validateCompliantCopy },
    {
      name: "related",
      type: "array",
      label: "Related links",
      maxRows: 4,
      admin: { description: "Shown in the sidebar: a site page (/insurance/motor) or another guide." },
      fields: [
        { name: "label", type: "text", required: true, localized: true },
        { name: "href", type: "text", required: true, validate: (v: unknown) => (safeHref(v) ? true : "Use a site path (/claims) or a full https:// address.") },
      ],
    },
    { name: "relatedArticles", type: "relationship", relationTo: "articles", hasMany: true, maxRows: 3, admin: { description: "Guides listed under \"More guides\". Empty = the three most recent." } },
    seoGroup,
  ],
};
