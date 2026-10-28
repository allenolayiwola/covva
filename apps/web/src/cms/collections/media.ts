import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectionConfig } from "payload";
import { staff } from "../access";
import { revalidateCollection } from "../hooks/revalidate";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Images and PDFs. In production the S3 plugin (Supabase Storage bucket `cms-media`) stores the
 * files; without storage credentials they land in `apps/web/.cms-media` (gitignored), which only
 * works on a developer machine, never on Vercel.
 */
export const Media: CollectionConfig = {
  slug: "media",
  admin: { group: "Content", description: "Partner logos, article cover images and press files. Alt text is required for accessibility." },
  access: { read: () => true, create: staff, update: staff, delete: staff },
  hooks: revalidateCollection("media"),
  upload: {
    staticDir: path.resolve(dirname, "../../../.cms-media"),
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/avif", "application/pdf"],
    focalPoint: true,
  },
  fields: [
    { name: "alt", type: "text", required: true, localized: true, admin: { description: "What the image shows, for screen readers. Decorative images: describe them anyway; the site decides." } },
    { name: "caption", type: "text", localized: true },
  ],
};
