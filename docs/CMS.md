# Marketing CMS (Payload)

Status: 28 October 2026. Companion to `docs/MARKETING_SITE.md` §5 and the "Headless CMS" line in `docs/ROADMAP.md`.

Covva's marketing pages, Learn articles, help-centre FAQs, testimonials and partner logos are editable by staff in a
Payload CMS admin at **`/cms`** on the web app, without code changes. The site keeps rendering exactly as before when
the CMS is empty or not configured: every reader falls back to the typed content that always lived in
`apps/web/src/components/marketing/`.

Covva is a technology platform. It is never an insurer or a broker and never holds premiums; the CMS enforces that in
copy validation (see "Compliance" below).

## 1. Decision: Payload 3 inside the web app

- **Versions.** `payload@3.92.1` with `@payloadcms/next`, `@payloadcms/db-postgres`, `@payloadcms/richtext-lexical`
  and `@payloadcms/storage-s3`. Their peer ranges (checked in `node_modules` on 28 Oct 2026) are
  `next >=16.3.3 <17` and `react ^19.0.1 || ^19.1.2 || ^19.2.1`, so Next 16.4.3 and React 19.3.0 are supported.
  Payload therefore runs **inside `apps/web`** (option A of the brief): `withPayload()` wraps `next.config.ts`, the
  config lives at `apps/web/src/cms/payload.config.ts`, the admin is mounted by the `(payload)` route group at `/cms`
  (REST at `/cms-api`, used only by the admin UI), and the site reads content through Payload's **Local API**, with
  no HTTP hop. Payload 4 is in beta and was not used.
- **Route groups.** Payload's admin needs its own root layout (`<html>`), so the former root layout and every site
  route group moved one level down into `apps/web/src/app/(site)/` (`(auth)`, `(customer)`, `(marketing)`,
  `(partner)`, `embed`, `layout.tsx`, `not-found.tsx`). URLs did not change. Metadata routes (`sitemap.ts`,
  `robots.ts`, `manifest.ts`, icons, `opengraph-image.tsx`) and `api/` stay at `app/`.
- **ESM marker.** `apps/web/src/cms/package.json` (`"type": "module"`) makes the Payload CLI load the config graph
  as ESM. Without it tsx converts Payload to CommonJS and `undici` throws `Illegal constructor`. The web app itself
  stays CommonJS-typed so `playwright.config.js` keeps working.
- **Type-check memory.** Payload's type graph pushes `next build`'s TypeScript step and `tsc` close to Node's
  default 2 GB heap (one run hit it), so the web `build` and `typecheck` scripts set
  `NODE_OPTIONS=--max-old-space-size=4096` (CI runners and Vercel builds have 7–8 GB).
- **Bundle impact.** Nothing from Payload is imported by a client component; the marketing client JS is unchanged
  (home page 11 scripts, 647 KB raw / 204 KB gzip before and after). Payload is loaded lazily on the server
  (`await import("@/cms/client")`) only when `DATABASE_URI` is set.

## 2. Architecture

```
apps/web/src/cms/
  payload.config.ts      buildConfig: routes /cms + /cms-api, localization, db (schema "cms"), S3 media, no GraphQL
  env.ts                 cmsEnv() / cmsConfigured(): unset DATABASE_URI or PAYLOAD_SECRET = CMS disabled
  client.ts              getPayloadClient() — Local API, server-only, imported lazily
  access.ts              staff / admin access rules
  editor.ts              the Lexical editor (paragraphs, h2–h3, bold, italic, links, lists, quote, rule, Tip block)
  collections/           pages, articles, faqs, testimonials, partners, media, users
  fields/seo.ts          shared SEO group + admin "Preview" URL
  hooks/revalidate.ts    afterChange / afterDelete → revalidateTag("cms", "cms:<collection>")
  migrations/            Payload migrations (payload migrate:create / payload migrate)
  seed.ts                first admin + import of today's typed content (idempotent)
  payload-types.ts       generated (pnpm --filter @im/web cms:generate)
apps/web/src/app/(payload)/
  layout.tsx             Payload root layout, or a "CMS is not configured" document
  cms/[[...segments]]/   admin UI;  cms/importMap.js is generated
  cms-api/[...slug]/     REST handlers (503 when the CMS is off)
apps/web/src/server/cms.ts         site readers ('use cache' + tags, draft mode aware, typed fallbacks)
apps/web/src/components/marketing/
  rich-text.tsx          safe renderer for the RichNode tree (no HTML injection)
  cms-page.tsx           block renderer for CMS pages (hero, text, FAQ list, CTA band, partner strip, testimonials)
  partner-logos.tsx      CMS partner logos (next/image, name as text fallback)
  article-page.tsx       Learn article view shared by /learn/[slug] and /learn/[slug]/[lang]
  preview-banner.tsx     "Preview — exit" bar (client, cookie-driven)
apps/web/src/app/api/preview/      draft-mode on (CMS login required) and /exit
packages/core/src/cms.ts           pure rules: slug validation + reserved routes, compliance copy check,
                                   Lexical → RichNode serializer, typed-blocks ↔ Lexical, FAQ grouping, fallbacks
```

**Database.** `@payloadcms/db-postgres` with `schemaName: "cms"` on the Supabase Postgres (`DATABASE_URI`, the
pooled connection string). The `cms` schema is not exposed through PostgREST, has no RLS and is never touched by
`supabase/migrations`. Payload's own tables (including `payload_migrations`, `payload_jobs`) all live in `cms`.
`push` is off: schema changes are explicit migrations.

**Readers and caching.** Every reader in `server/cms.ts` is a `'use cache'` function (`cacheLife("hours")`) tagged
`cms` and `cms:<collection>`; a publish in the admin calls `revalidateTag` through the collection hooks, so the
next request renders the new content. When the CMS is unconfigured, unreachable or has no published documents for a
section, the reader returns the typed content (`articles.ts`, `content.ts`) or, for the partner strip, the partner
directory from the application database. A CMS outage therefore cannot take the marketing site down.

**Where the site reads the CMS**

| Site | Reader | Fallback |
|---|---|---|
| `/learn`, `/learn/[slug]`, sitemap | `getArticles`, `getArticle`, `getArticleLocales` | `ARTICLES` (typed) |
| `/learn/[slug]/[lang]` (tw, gaa, ee) | `getArticle(slug, locale)` | English text + "translation in progress" notice |
| `/support` FAQ search + FAQ schema | `getFaqGroups` | `FAQ_GROUPS` |
| Home "Good to know", `/claims` FAQ | `getFaqsFor("home" \| "claims")` | `HOME_FAQ_IDS` / claims ids |
| Home testimonials | `getTestimonials` | `TESTIMONIALS` (illustrative) |
| Home trust bar | `getPartners` | partner directory (insurers) and text payment badges |
| `/pages/<slug>` CMS pages, sitemap | `getPage`, `getPageSlugs` | 404 (as before) |

The WhatsApp FAQ assistant (`server/whatsapp/assistant.ts`) still uses the typed `FAQ_GROUPS`; wiring it to the CMS
is a follow-up.

## 3. Collections

| Collection | Fields | Notes |
|---|---|---|
| `pages` | title*, slug*, layout blocks (hero, text, FAQ list, CTA band, partner logos, testimonials), SEO | Served at `/pages/<slug>`. Names of routes the site already serves are refused (`RESERVED_PAGE_SLUGS`), so a top-level vanity redirect can be added later. |
| `articles` | title*, slug*, summary*, topic, author, reading time (auto), published date, cover image, body*, related links, related articles, SEO | Learn hub. `/learn/<slug>`; translations at `/learn/<slug>/<lang>`. |
| `faqs` | key*, question*, answer* (plain text), category, order, placements (help centre / home / claims) | Answers feed the FAQ search and FAQ schema. |
| `testimonials` | key*, quote*, name as displayed*, role/location*, illustrative (default on), consent on file, order | Cannot be saved as genuine without consent on file. |
| `partners` | name*, slug*, type (insurer / broker / payment), logo, URL, brand colour, NIC licence number, order, show on site | Insurer/broker logos replace the directory list once any is published; payment logos replace the text badges once one has a logo. |
| `media` | file (jpeg/png/webp/svg/avif/pdf, 8 MB), alt* (localized), caption | Supabase Storage via S3 (see §4). |
| `users` | email*, password*, name*, role (admin / editor) | Payload's own auth, no sign-up. |

Localization is on for every text and rich-text field: `en` (default), `tw`, `gaa` (Ga; `ga` is Irish, so the
site's ISO 639-3 code is kept), `ee`, with fallback to English. Nothing is machine-translated. Pages, articles,
FAQs, testimonials and partners have drafts, autosave, version history (20–25 versions) and scheduled publish.

**Compliance.** Every copy field (and rich text, through its plain text) is validated with
`validateCompliantCopy` from `@im/core`: text that describes Covva (or "we") as an insurer, broker or underwriter,
or as holding premiums / client money, is rejected on save with a message; negated statements ("Covva is not an
insurer or a broker") pass. The editorial note is shown in every collection description. Testimonials: a quote may
only drop the "Illustrative" label when `consentOnFile` is ticked; the site labels everything else. The partner strip
is always headed "Licensed partners only", whatever heading an editor types.

## 4. Environment variables

| Variable | Secret | Required | Purpose |
|---|---|---|---|
| `DATABASE_URI` | **yes** | for the CMS | Pooled Supabase Postgres connection string (Supabase → Connect → Transaction pooler; `?sslmode=require`). Unset = CMS disabled, site uses typed content. |
| `PAYLOAD_SECRET` | **yes** | for the CMS | 32+ random characters; signs CMS sessions. Unset = CMS disabled. |
| `CMS_S3_ENDPOINT` | no | for uploads | Supabase Storage S3 endpoint, `https://<ref>.storage.supabase.co/storage/v1/s3`. |
| `CMS_S3_REGION` | no | for uploads | `eu-west-2` (the project region). |
| `CMS_S3_BUCKET` | no | no | Bucket name, default `cms-media`. Create it **public** in Supabase Storage. |
| `CMS_S3_ACCESS_KEY_ID`, `CMS_S3_SECRET_ACCESS_KEY` | **yes** | for uploads | Supabase Storage → S3 access keys. |
| `CMS_MEDIA_PUBLIC_URL` | no | for uploads | Public base of the bucket: `https://<ref>.supabase.co/storage/v1/object/public/cms-media`. |
| `CMS_ADMIN_EMAIL`, `CMS_ADMIN_PASSWORD` (12+ chars), `CMS_ADMIN_NAME` | **yes** | seed only | First admin, created by `cms:seed` when no user exists. Not needed at runtime. |
| `CRON_SECRET` | **yes** | existing | The `cms-jobs` cron (`/api/cron/cms-jobs`, every 15 min) runs scheduled publishes. |

Without the four `CMS_S3_*` values and `CMS_MEDIA_PUBLIC_URL`, uploads are written to `apps/web/.cms-media`
(gitignored), which only works on a developer machine. The web app's `images.remotePatterns` already allows the
Supabase public storage host. The build never needs any of these: CI (`ci.yml`) runs with none of them set.

## 5. Deploying

1. **Secrets.** Set `DATABASE_URI`, `PAYLOAD_SECRET` and the storage variables on the **web** Vercel project
   (Production and Preview). Create the `cms-media` bucket (public) and S3 access keys in Supabase.
2. **Schema.** From a machine with `DATABASE_URI` in `apps/web/.env.local`:
   `pnpm --filter @im/web cms:migrate` — applies `apps/web/src/cms/migrations/*` (first run creates schema `cms`).
   Run it again after every deploy that adds a migration (or add it as a step of the release checklist; the build
   itself does not migrate). Schema changes in code: edit the collections, then
   `pnpm --filter @im/web cms:migrate:create <name>` against a database that has the previous migrations, review the
   generated file, commit it with `pnpm --filter @im/web cms:generate` (types + import map).
3. **Seed.** `CMS_ADMIN_EMAIL=… CMS_ADMIN_PASSWORD=… pnpm --filter @im/web cms:seed` creates the first admin and
   imports today's articles, FAQs, testimonials and the payment-method partners as published documents. It is
   idempotent (matched by slug / key, never overwritten). Do this **before** `/cms` is reachable: Payload shows a
   "create first user" screen while the users table is empty.
4. **Edge protection.** The admin is for Covva staff only and uses Payload's own accounts. Until SSO with the
   staff directory is wired, additionally protect `/cms` and `/cms-api` at the edge: Vercel → Project → Settings →
   Deployment Protection (password or Vercel Authentication) scoped to those paths, or a Vercel Firewall rule
   allowing only the office / VPN IP range. Keep the login lockout (5 attempts, 10 minutes) and 8-hour sessions.
5. **Verify.** `/cms` shows the login; `/cms-api/users/me` answers 401 anonymously; the home page still renders
   with the directory logos until partners get logos.

Rollback: unset `DATABASE_URI` on the project and redeploy — the admin shows "not configured" and the site renders
its typed content. Content stays in the `cms` schema.

## 6. Editing, publishing, preview

- **Save draft / Publish.** Every content collection has drafts with autosave. "Save draft" never changes the site;
  "Publish" does on the next request (`revalidateTag(tag, { expire: 0 })` in the collection hooks, so editors never see a stale view). "Schedule publish" (and unpublish) queues a job that the
  `cms-jobs` cron runs every 15 minutes.
- **Preview.** The **Preview** button opens `/api/preview?path=…`: the route checks the editor's CMS session cookie
  through the Local API, turns on Next draft mode for that browser and redirects to the page, which renders the
  latest draft. A yellow bar ("Preview: you are seeing unpublished CMS changes — Exit preview") stays until
  `/api/preview/exit`. Draft mode reads bypass the cache, so previews are always fresh.
- **Translations.** Switch the locale in the admin (top right) and fill the Twi / Ga / Ewe fields by hand. The Learn
  hub language switcher appears only when at least one article has a translation; a reader who chooses a language
  for an untranslated article sees the English text with a "translation in progress" notice, and that URL is not
  indexed as a translation (canonical stays the English page).
- **Images.** Upload to Media with alt text; partner logos should be SVG/PNG with a transparent background, at
  least 160 px wide. The site shows a logo at 32 px high and keeps the name available to screen readers.
- **Accounts.** Admins create accounts in CMS users and can set a new password there (there is no email adapter, so
  "forgot password" emails are printed to the server log only).

## 7. Local development

```
# apps/web/.env.local
DATABASE_URI=postgresql://postgres@localhost:54329/cms_dev   # any Postgres 16; never the shared Supabase project
PAYLOAD_SECRET=dev-secret-at-least-32-characters-long
pnpm --filter @im/web cms:migrate
CMS_ADMIN_EMAIL=you@covva.com.gh CMS_ADMIN_PASSWORD=choose-a-long-one pnpm --filter @im/web cms:seed
pnpm --filter @im/web dev   # /cms
```

Verified on 28 Oct 2026 against a throwaway local Postgres 16: `cms:migrate` created 66 tables in schema `cms`
(0 in `public`), `cms:seed` created 1 user, 7 articles, 25 FAQs, 3 testimonials, 5 partners and was a no-op on the
second run; `next build` passed with no CMS env and with `DATABASE_URI` set.

## 8. Follow-ups

- Live preview (Payload's iframe + `RefreshRouteOnSave`) was left out to keep marketing client bundles unchanged.
- SSO for `/cms` (Supabase Auth / staff directory) instead of Payload accounts + edge protection.
- WhatsApp assistant FAQs from the CMS; press kit and legal pages as CMS pages once counsel signs off the copy.
- An email adapter (Resend) for password resets.
