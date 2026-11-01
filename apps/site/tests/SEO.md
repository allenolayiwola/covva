# SEO regression checks

`pnpm test` covers site-origin precedence and absolute home/per-page OG metadata.
`seo-rendered.mjs` checks the actual HTML for every static marketing route and every sitemap URL: unique titles/descriptions, one h1, canonical origin, an absolute OG image, JSON parsing and schema types for every emitted JSON-LD block, FAQ content matching rendered content, breadcrumb order, and PNG responses. Existing contact email addresses are preserved; the stale-origin assertion covers website URLs.

For a reproducible production build with no live data, run these commands from `apps/web` (keep the fixture and Next server running in separate terminals):

```sh
node tests/fixtures/seo-api.mjs

export NEXT_PUBLIC_SITE_URL=https://insurance-marketplace-tau.vercel.app
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-publishable-key
pnpm build
pnpm start --port 3100

SEO_TEST_BASE_URL=http://localhost:3100 NEXT_PUBLIC_SITE_URL=https://insurance-marketplace-tau.vercel.app node tests/seo-rendered.mjs
```

Keep CMS/database/provider credentials unset. This fixture serves an empty public catalogue; built-in article, FAQ and cover copy still renders. It does not validate live catalogue entries or CMS overrides. The cover route on this branch is `/insurance/[slug]`; the single sitemap source is `src/app/sitemap.ts`.
