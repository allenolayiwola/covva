import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { s3Storage } from "@payloadcms/storage-s3";
import sharp from "sharp";
import { CMS_DEFAULT_LOCALE, CMS_LOCALES } from "@im/core";
import { cmsEnv } from "./env";
import { editor } from "./editor";
import { Articles } from "./collections/articles";
import { Faqs } from "./collections/faqs";
import { Media } from "./collections/media";
import { Pages } from "./collections/pages";
import { Partners } from "./collections/partners";
import { Testimonials } from "./collections/testimonials";
import { Users } from "./collections/users";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const env = cmsEnv();

/**
 * Payload CMS for the marketing site (docs/CMS.md).
 *
 * - Lives in the web app: admin at /cms, REST at /cms-api, content read through the Local API.
 * - Data in the Supabase Postgres, schema `cms` (not exposed through PostgREST, no RLS needed).
 *   Schema changes are explicit migrations in ./migrations (`payload migrate:create`, `payload migrate`).
 * - Nothing here is required at build time: with DATABASE_URI unset the admin shows a notice and the
 *   site renders the typed content it always had.
 */
export default buildConfig({
  serverURL: env.siteUrl,
  secret: env.secret ?? "cms-disabled-no-secret-configured",
  routes: { admin: "/cms", api: "/cms-api" },
  cookiePrefix: "covva-cms",
  csrf: [env.siteUrl],
  admin: {
    user: Users.slug,
    importMap: { baseDir: dirname, importMapFile: path.resolve(dirname, "../app/(payload)/cms/importMap.js") },
    meta: { titleSuffix: " · Covva CMS", description: "Covva marketing content" },
    dateFormat: "d MMM yyyy HH:mm",
    suppressHydrationWarning: true,
  },
  collections: [Pages, Articles, Faqs, Testimonials, Partners, Media, Users],
  editor,
  localization: {
    locales: CMS_LOCALES.map((l) => ({ label: l.label, code: l.code })),
    defaultLocale: CMS_DEFAULT_LOCALE,
    fallback: true,
  },
  db: postgresAdapter({
    // With the CMS disabled nothing ever connects (see env.ts guards); the placeholder keeps the config valid.
    pool: { connectionString: env.databaseUri ?? "postgresql://cms-disabled@localhost:1/cms_disabled", max: 5 },
    schemaName: "cms",
    migrationDir: path.resolve(dirname, "migrations"),
    // Never auto-push schema changes, even in development: run `payload migrate` (docs/CMS.md).
    push: false,
  }),
  sharp,
  graphQL: { disable: true },
  telemetry: false,
  typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
  upload: { limits: { fileSize: 8 * 1024 * 1024 } },
  plugins: [
    s3Storage({
      enabled: Boolean(env.storage),
      bucket: env.storage?.bucket ?? "cms-media",
      collections: {
        media: {
          disablePayloadAccessControl: true,
          generateFileURL: ({ filename, prefix }) => `${env.storage?.publicUrl ?? ""}/${[prefix, filename].filter(Boolean).join("/")}`,
        },
      },
      config: {
        endpoint: env.storage?.endpoint ?? "https://invalid.local",
        region: env.storage?.region ?? "eu-west-2",
        forcePathStyle: true,
        credentials: { accessKeyId: env.storage?.accessKeyId ?? "", secretAccessKey: env.storage?.secretAccessKey ?? "" },
      },
    }),
  ],
});
