import type { Block, CollectionConfig, Field } from "payload";
import { FAQ_CATEGORIES, PARTNER_TYPES, isValidSlug, safeHref, validateCompliantCopy, validatePageSlug } from "@im/core";
import { publishedOrStaff, staff } from "../access";
import { EDITORIAL_NOTE, editor } from "../editor";
import { previewUrl, seoGroup } from "../fields/seo";
import { revalidateCollection } from "../hooks/revalidate";

const linkFields = (name: string, label: string, required = false): Field => ({
  name,
  type: "group",
  label,
  fields: [
    { name: "label", type: "text", required, localized: true },
    { name: "href", type: "text", required, validate: (v: unknown) => (!v || safeHref(v) ? true : "Use a site path (/quote) or a full https:// address.") },
  ],
});

const RichTextBlock: Block = {
  slug: "richText",
  labels: { singular: "Text", plural: "Text blocks" },
  fields: [{ name: "content", type: "richText", required: true, localized: true, editor, validate: validateCompliantCopy }],
};

const HeroBlock: Block = {
  slug: "hero",
  labels: { singular: "Hero", plural: "Heroes" },
  fields: [
    { name: "eyebrow", type: "text", localized: true, validate: validateCompliantCopy },
    { name: "title", type: "text", required: true, localized: true, validate: validateCompliantCopy },
    { name: "lede", type: "textarea", localized: true, validate: validateCompliantCopy },
    linkFields("primary", "Primary button"),
    linkFields("secondary", "Secondary button"),
  ],
};

const FaqListBlock: Block = {
  slug: "faqList",
  labels: { singular: "FAQ list", plural: "FAQ lists" },
  fields: [
    { name: "heading", type: "text", localized: true, validate: validateCompliantCopy },
    { name: "faqs", type: "relationship", relationTo: "faqs", hasMany: true, admin: { description: "Pick specific questions, or leave empty and choose a category." } },
    { name: "category", type: "select", options: FAQ_CATEGORIES.map((c) => ({ label: c.title, value: c.id })) },
  ],
};

const CtaBandBlock: Block = {
  slug: "ctaBand",
  labels: { singular: "Call to action", plural: "Calls to action" },
  fields: [
    { name: "title", type: "text", required: true, localized: true, validate: validateCompliantCopy },
    { name: "body", type: "textarea", localized: true, validate: validateCompliantCopy },
    linkFields("primary", "Primary button", true),
    linkFields("secondary", "Secondary button"),
  ],
};

const PartnerStripBlock: Block = {
  slug: "partnerStrip",
  labels: { singular: "Partner logos", plural: "Partner logo strips" },
  fields: [
    { name: "heading", type: "text", localized: true, defaultValue: "Licensed partners only", validate: validateCompliantCopy },
    { name: "types", type: "select", hasMany: true, defaultValue: ["insurer", "broker"], options: PARTNER_TYPES.map((t) => ({ label: t.label, value: t.id })) },
  ],
};

const TestimonialStripBlock: Block = {
  slug: "testimonialStrip",
  labels: { singular: "Testimonials", plural: "Testimonial strips" },
  fields: [
    { name: "heading", type: "text", localized: true, validate: validateCompliantCopy },
    { name: "testimonials", type: "relationship", relationTo: "testimonials", hasMany: true, admin: { description: "Leave empty to show every published testimonial." } },
  ],
};

export const PAGE_BLOCKS = [HeroBlock, RichTextBlock, FaqListBlock, CtaBandBlock, PartnerStripBlock, TestimonialStripBlock];

/** Marketing pages composed from blocks, served at /pages/<slug>. */
export const Pages: CollectionConfig = {
  slug: "pages",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "slug", "_status", "updatedAt"],
    group: "Content",
    preview: previewUrl((doc) => (isValidSlug(doc.slug) ? `/pages/${doc.slug}` : null)),
    description: `Landing and campaign pages built from blocks. Every page keeps the site header, footer, consent banner and disclosures. ${EDITORIAL_NOTE}`,
  },
  access: { read: publishedOrStaff, create: staff, update: staff, delete: staff },
  versions: { drafts: { autosave: { interval: 2000 }, schedulePublish: true }, maxPerDoc: 25 },
  hooks: revalidateCollection("pages"),
  fields: [
    { name: "title", type: "text", required: true, localized: true, validate: validateCompliantCopy },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      validate: validatePageSlug,
      admin: { position: "sidebar", description: "The address: covva.com.gh/pages/<slug>. Names of routes the site already serves (learn, support, …) are refused so a vanity redirect can be added later." },
    },
    { name: "layout", type: "blocks", required: true, minRows: 1, blocks: PAGE_BLOCKS },
    seoGroup,
  ],
};
