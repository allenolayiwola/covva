import type { CollectionConfig } from "payload";
import { isValidSlug, testimonialPublishable, validateCompliantCopy } from "@im/core";
import { publishedOrStaff, staff } from "../access";
import { EDITORIAL_NOTE } from "../editor";
import { revalidateCollection } from "../hooks/revalidate";

export const Testimonials: CollectionConfig = {
  slug: "testimonials",
  admin: {
    useAsTitle: "name",
    defaultColumns: ["name", "context", "illustrative", "consentOnFile", "order", "_status"],
    group: "Content",
    description: `Customer quotes on the home page. A quote may only be published as genuine when the customer's written consent is on file; otherwise mark it illustrative and the site labels it so. Never invent named reviews. ${EDITORIAL_NOTE}`,
  },
  access: { read: publishedOrStaff, create: staff, update: staff, delete: staff },
  versions: { drafts: { autosave: { interval: 2000 }, schedulePublish: true }, maxPerDoc: 20 },
  hooks: {
    ...revalidateCollection("testimonials"),
    beforeValidate: [
      ({ data }) => {
        const verdict = testimonialPublishable({ illustrative: data?.illustrative, consentOnFile: data?.consentOnFile });
        if (verdict !== true) throw new Error(verdict);
        return data;
      },
    ],
  },
  fields: [
    {
      name: "key",
      type: "text",
      required: true,
      unique: true,
      index: true,
      validate: (v: unknown) => (isValidSlug(v) ? true : "Lower-case letters, digits and hyphens only."),
      admin: { position: "sidebar", description: "Stable id (for example driver-accra-2026)." },
    },
    { name: "quote", type: "textarea", required: true, localized: true, validate: validateCompliantCopy },
    { name: "name", type: "text", required: true, admin: { description: "Name as displayed. For illustrative quotes use a neutral description (\"Driver, Accra\"), never a real-sounding name." } },
    { name: "context", type: "text", required: true, label: "Role / location / product", admin: { description: "For example \"Motor · comprehensive\" or \"Shop owner, Takoradi\"." } },
    {
      name: "illustrative",
      type: "checkbox",
      defaultValue: true,
      admin: { position: "sidebar", description: "Shown with an \"Illustrative\" label. Untick only for a genuine review with consent on file." },
    },
    {
      name: "consentOnFile",
      type: "checkbox",
      defaultValue: false,
      label: "Consent on file",
      admin: { position: "sidebar", description: "The customer agreed in writing to be quoted (keep the record in the shared drive)." },
    },
    { name: "order", type: "number", defaultValue: 100, admin: { position: "sidebar" } },
  ],
};
