import type { Field, GeneratePreviewURL } from "payload";
import { validateCompliantCopy } from "@im/core";
import { cmsEnv } from "../env";

/** Search-engine fields shared by pages and articles. Empty values fall back to the title / summary. */
export const seoGroup: Field = {
  name: "seo",
  type: "group",
  label: "Search engines (SEO)",
  fields: [
    { name: "title", type: "text", localized: true, maxLength: 70, validate: validateCompliantCopy, admin: { description: "Up to 70 characters. Leave empty to use the page title." } },
    { name: "description", type: "textarea", localized: true, maxLength: 160, validate: validateCompliantCopy, admin: { description: "Up to 160 characters. Leave empty to use the summary / lede." } },
    { name: "noIndex", type: "checkbox", defaultValue: false, label: "Hide from search engines" },
  ],
};

/**
 * "Preview" button in the admin: opens the page through /api/preview, which turns on Next draft
 * mode for that browser (the editor must be signed in to the CMS) and shows unpublished changes.
 */
export function previewUrl(pathFor: (doc: Record<string, unknown>) => string | null): GeneratePreviewURL {
  return (doc, { locale }) => {
    const path = pathFor(doc);
    if (!path) return null;
    const params = new URLSearchParams({ path });
    if (locale && locale !== "en") params.set("locale", locale);
    return `${cmsEnv().siteUrl}/api/preview?${params.toString()}`;
  };
}
