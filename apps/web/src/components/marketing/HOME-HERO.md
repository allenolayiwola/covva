# Home Hero A

The home route renders the first `hero` block from the published Payload page with slug `home-hero`. Editors can change its eyebrow, title (line breaks are respected), and lede. Existing CMS page caching, publication access, draft preview and `cms:pages` revalidation apply. If the page or hero is missing, or the CMS is unavailable, `HOME_HERO` supplies the approved board copy.

The existing `cms:seed` now creates that page only when absent. It never overwrites an existing page or deletes any data. The existing hero schema is sufficient: no database migration is required. This change does not execute the seed. The page is seeded with `seo.noIndex: true` so its generic `/pages/home-hero` preview does not enter the sitemap.

The fixed Mural photo, visible AI label, cover disclaimer and native quote form are rendered by the home component. They cannot be removed by changing the hero text. The six radio values submit to `/quote?type=…`; the quote flow also continues to accept legacy `?category=…` links. Quote continuation requires the existing JavaScript-based quote flow; only the home picker and GET navigation are guaranteed without JavaScript.

The previous carousel modules are retained as unused source, preserving their data. They are no longer mounted on home, so there is no autoplay, animated photo, or experiment overriding the approved copy.
