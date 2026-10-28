import type { CollectionConfig } from "payload";
import { PARTNER_TYPES, isValidSlug, safeHref } from "@im/core";
import { publishedOrStaff, staff } from "../access";
import { revalidateCollection } from "../hooks/revalidate";

export const Partners: CollectionConfig = {
  slug: "partners",
  admin: {
    useAsTitle: "name",
    defaultColumns: ["name", "type", "order", "showOnSite", "_status"],
    group: "Content",
    description:
      "Logos in the home-page trust bar. Only NIC-licensed insurers and brokers, and authorised payment providers: the strip is always headed \"Licensed partners only\". Insurer and broker logos replace the database directory on the home page once at least one is published and shown; payment logos replace the text badges once at least one has a logo.",
  },
  access: { read: publishedOrStaff, create: staff, update: staff, delete: staff },
  versions: { drafts: { autosave: { interval: 2000 }, schedulePublish: true }, maxPerDoc: 20 },
  hooks: revalidateCollection("partners"),
  fields: [
    { name: "name", type: "text", required: true },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      validate: (v: unknown) => (isValidSlug(v) ? true : "Lower-case letters, digits and hyphens only."),
      admin: { position: "sidebar", description: "Match the organisation slug in the partner directory where one exists (for example coastline-general)." },
    },
    { name: "type", type: "select", required: true, options: PARTNER_TYPES.map((t) => ({ label: t.label, value: t.id })), admin: { position: "sidebar" } },
    { name: "logo", type: "upload", relationTo: "media", admin: { description: "SVG or PNG with transparent background, at least 160px wide. The name is shown as text when there is no logo." } },
    { name: "url", type: "text", validate: (v: unknown) => (!v || safeHref(v) ? true : "Enter a full https:// address."), admin: { description: "Partner website (optional)." } },
    { name: "brandColor", type: "text", admin: { position: "sidebar", description: "#RRGGBB, used for the monogram tile when there is no logo." } },
    { name: "licenceNumber", type: "text", label: "NIC licence number", admin: { position: "sidebar", description: "Insurers and brokers: the NIC licence reference (shown on hover)." } },
    { name: "order", type: "number", defaultValue: 100, admin: { position: "sidebar" } },
    { name: "showOnSite", type: "checkbox", defaultValue: true, label: "Show on site", admin: { position: "sidebar" } },
  ],
};
