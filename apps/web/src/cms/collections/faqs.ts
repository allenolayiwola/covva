import type { CollectionConfig } from "payload";
import { FAQ_CATEGORIES, FAQ_PLACEMENTS, isValidSlug, validateCompliantCopy } from "@im/core";
import { publishedOrStaff, staff } from "../access";
import { EDITORIAL_NOTE } from "../editor";
import { revalidateCollection } from "../hooks/revalidate";

export const Faqs: CollectionConfig = {
  slug: "faqs",
  labels: { singular: "FAQ", plural: "FAQs" },
  admin: {
    useAsTitle: "question",
    defaultColumns: ["question", "category", "order", "placements", "_status"],
    group: "Content",
    description: `Help-centre questions and answers. Answers are plain text (they feed the FAQ search and the FAQ schema for search engines). ${EDITORIAL_NOTE}`,
  },
  access: { read: publishedOrStaff, create: staff, update: staff, delete: staff },
  versions: { drafts: { autosave: { interval: 2000 }, schedulePublish: true }, maxPerDoc: 20 },
  hooks: revalidateCollection("faqs"),
  fields: [
    {
      name: "key",
      type: "text",
      required: true,
      unique: true,
      index: true,
      validate: (v: unknown) => (isValidSlug(v) ? true : "Lower-case letters, digits and hyphens only (used as the anchor #faq-<key>)."),
      admin: { position: "sidebar", description: "Stable id used for the page anchor (#faq-key). Do not change after publishing." },
    },
    { name: "question", type: "text", required: true, localized: true, validate: validateCompliantCopy },
    { name: "answer", type: "textarea", required: true, localized: true, validate: validateCompliantCopy },
    {
      name: "category",
      type: "select",
      required: true,
      options: FAQ_CATEGORIES.map((c) => ({ label: c.title, value: c.id })),
      admin: { position: "sidebar" },
    },
    { name: "order", type: "number", defaultValue: 100, admin: { position: "sidebar", description: "Lower numbers show first within the category." } },
    {
      name: "placements",
      type: "select",
      hasMany: true,
      defaultValue: ["support"],
      options: FAQ_PLACEMENTS.map((p) => ({ label: p.label, value: p.id })),
      admin: { position: "sidebar", description: "Where this answer is shown. The help centre lists every published FAQ." },
    },
  ],
};
