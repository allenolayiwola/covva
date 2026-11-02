# Marketing site — analytics, experiments, performance and content

Status: 1 November 2026. Companion to the "Marketing site (Addendum 5)" section of `docs/ROADMAP.md`.
Everything here lives under `apps/site/src/components/marketing/` and `apps/site/src/app/(site)/(marketing)/` (the marketing site, covva-site; see `docs/APPS.md`); nothing touches the
customer app, partner workspace, API or database.

## 1. Consent model (Act 843)

One first-party cookie, `covva_consent` (180 days), with three values. Nothing non-essential loads until the visitor chooses.

| Value | Loads | How the visitor gets there |
|---|---|---|
| `essential` | nothing | "Essential only" |
| `analytics` | GA4 | "Accept analytics" (builds without pixel ids) or "Choose for me" → analytics ticked |
| `all` | GA4 + Meta pixel + TikTok pixel | "Accept all" (only offered when a pixel id is configured) or "Choose for me" → both ticked |

- Banner: `consent-banner.tsx`. "Choose for me" shows the two categories as checkboxes; strictly necessary is always on.
- The cookie notice (`/legal/cookies`) lists every cookie, adapts its copy to what is configured, and has a
  **Change your cookie choices** control (`consent-settings.tsx`) that forgets the choice and brings the banner back.
- Builds with no pixel ids keep the "no advertising pixels" promise automatically: the banner, the notice and the vendor
  loader all key off `PIXELS_CONFIGURED`.

## 2. Vendors and events

`analytics.ts` is the single entry point. Vendors are read from env at build time and an unset id disables that vendor.

| Variable | Vendor | Gated by |
|---|---|---|
| `NEXT_PUBLIC_GA4_ID` | Google Analytics 4 (Consent Mode v2 defaults denied, updated to the choice, `anonymize_ip`) | analytics |
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta pixel (`PageView` on load) | marketing |
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | TikTok pixel (`page()` on load) | marketing |

`track(event, params)` forwards to whichever vendors the visitor has consented to and is a no-op otherwise (events are
not buffered: without consent there is no tracking). Params must never contain personal data.

| Event | Fired from | Params | Meta / TikTok name |
|---|---|---|---|
| `quote_start` | instant-quote widget submit (`quote-widget.tsx`) | `category`, `has_reg`, `placement` (`hero` / `product_page`) | `Search` / `Search` |
| `generate_lead` | enquiry, partner, waitlist, contact forms (`lead-form.tsx`); renewal reminder (`renewal-reminder-form.tsx`) | `kind`, `tag`, `page` | `Lead` / `SubmitForm` |
| `app_store_click` | App Store / Google Play badges (delegated listener in `analytics-clicks.tsx`) | `store`, `page` | custom |
| `whatsapp_click` | floating WhatsApp button (same listener) | `page` | custom |
| `experiment_exposure` | A/B variant shown (`experiment.tsx`) | `experiment`, `variant` | GA4 only |

Store badges and the WhatsApp button stay server components: `AnalyticsClicks` (mounted once in the marketing layout) listens
for clicks on `apps.apple.com`, `play.google.com` and `wa.me` links.

To add an event: extend the `TrackEvent` union in `analytics.ts`, map it in `META_EVENTS` / `TIKTOK_EVENTS` if a standard
vendor name exists, and call `track()` from a client component.

## 3. A/B testing hooks

`experiments.ts` holds the registry; `experiment.tsx` the hook and component.

```tsx
// Register
export const EXPERIMENTS = {
  home_hero_headline: { description: "…", variants: ["control", "instant"] }, // optional weights: [3, 1]
} as const satisfies Record<string, ExperimentDef>;

// Use (client component, or inside server JSX through <Experiment />)
<Experiment name="home_hero_headline" variants={{ control: <>…</>, instant: <>…</> }} />
const variant = useExperiment("home_hero_headline");
```

Rules of the road:
- An experiment runs only when its key is in `NEXT_PUBLIC_EXPERIMENTS` (comma-separated). Unset = everyone sees control
  and no cookie is written, so e2e, Lighthouse and SEO snapshots stay deterministic.
- Assignment is sticky per browser in the functional cookie `covva_exp` (90 days, `key:variant|…`, no personal data).
- QA override on any build, including production: `?exp=home_hero_headline:instant` (several: comma-separated). It is
  validated against the registry and persisted, so a variant can be reviewed before the test starts.
- The server always renders control; the variant is applied after hydration. Keep variants to copy, order or a CTA label so
  the swap does not shift layout. `TypeScript` requires every variant to have a branch.
- Exposure is reported once per page view per experiment via `experiment_exposure`; analyse by that event's `variant` param
  in GA4 (Explore → funnel from `experiment_exposure` to `quote_start` / `generate_lead`).
- Registered today: `home_hero_headline` (off): it switches the hero lede (slide 1's subline), not the `<h1>`, so the LCP
  element stays static server HTML. Switch it on by setting `NEXT_PUBLIC_EXPERIMENTS=home_hero_headline` on the covva-site project in Vercel and redeploying.

## 4. Lighthouse (production build, mobile emulation)

Home page, 1 November 2026 (Lighthouse 12, default simulated mobile throttling).

| Where | Runs | Median LCP | Median FCP | Performance | LCP element |
|---|---|---|---|---|---|
| Local production build (`next start`) | 10 | 3.3 s | 1.07 s | 89–92 | hero `<h1>` |
| covva-site.vercel.app | 3 | 2.9 s (2.0–3.0 s) | 1.08 s | 93–99 | hero `<h1>` |
| covva-site.vercel.app, desktop preset | 1 | 0.53 s | — | 100 | hero photo |

- Measured with the previous static hero (one photo). On phones the LCP element is the headline, not the photo: the
  photo sat below the quote form and was a 33 KB WebP.
  In the real trace the headline paints at first paint (observed LCP = FCP). The simulated LCP is higher because
  Lighthouse counts the fonts and scripts that load before that paint as blocking it, which is very pessimistic on
  localhost. A lighter phone photo does not move LCP.
- Tried and dropped (10 runs each, same build otherwise):
  - Preloading only Inter's basic Latin file (not latin-ext): LCP 3.31 s → 3.21 s, but FCP 1.07 s → 1.52 s, because the
    cedi sign (₵) lives in latin-ext and that file then loads late.
  - Normal priority for the photo on phones, with a high-priority preload limited to `(min-width: 768px)`: LCP 3.31 s →
    3.31 s, FCP 1.07 s → 1.52 s.
- What is left to cut is script: about 150 KB of client JavaScript loads before the headline paints in the simulated
  model. Reducing that is the next lever if LCP needs to fall further.

## 5. Home hero

`home-hero.tsx` (server: builds each slide's responsive image sources) + `home-hero-slideshow.tsx` (client: rotation,
controls, cover picker) + `home-hero-content.ts` (badge, chips, and `HOME_HERO_SLIDES`: headline, lede, suggested cover,
image, alt text). Timing and the picker's preselection rules are the pure functions in `packages/core/src/hero-carousel.ts`.

- Seven slides: welcome, motor, home, health, travel, business, life. Each has an illustrated scene on the right of a cream
  (#F6E9D5) hero, its own headline and lede, and preselects its cover in the quote card until the visitor picks one.
  Slides cross-fade every 7 s (`HERO_SLIDE_MS`, fade `HERO_FADE_MS`).
- Rotation pauses on hover, keyboard focus inside the hero, a hidden tab and the Pause button (WCAG 2.2.2).
  `prefers-reduced-motion: reduce` = no autoplay and instant swaps. The slide dots jump to a slide.
- Slide 1 is server-rendered; its headline is the page's only `<h1>` (later headlines and ledes are `aria-hidden`, and
  rotations are not announced). Headlines share one grid cell, so the tallest sets the height and nothing shifts.
  The other scenes mount after the page's `load` event, so they never compete with the first paint.
- The quote card is a plain GET form to `/quote?type=` with native radios. The button reads "Start my motor quote" and
  follows the chosen cover through CSS (`.hero-cta` rules in `globals.css`), so it also works without JavaScript.
- The headline is Outfit SemiBold (600), the one heavy headline on the site (`.hero-title` in `globals.css`). Outfit is
  loaded as a variable font for this.
- Layout: on tablet and up the scene fills the right 60% of the hero (from 42% on wide screens) and its left edge blends
  into the cream. On phones the copy and card come first and the scene follows as a band (a crop around the scene).
- Images: `public/images/home-hero/{slide}.webp` (3840×2160) and `{slide}-mobile.webp` (1200×1364), served by
  `next/image` at quality 85 with sizes up to 3840w. They are AI-generated illustrations with the visible credit
  **Image: AI-generated**; see that folder's README for provenance and how to replace one.
- Copy rules: Covva compares and connects; licensed brokers arrange cover; licensed insurers issue it.

**Unused:** the earlier four-slide photo carousel (`home-hero-carousel.tsx`, `hero-slides.ts` and the JPEGs in
`src/assets/hero/`) is no longer rendered. The new slideshow reuses its timing helpers in `packages/core`.

## 6. Content

Marketing copy, Learn articles, FAQs and testimonials live in code (`apps/site/src/components/marketing/content.ts`,
`articles.ts`) and are read through `apps/site/src/server/content.ts`. Payload CMS was built and then removed in
November 2026; a content change is a code change.

## 7. Still waiting on assets

- Commissioned photography of real Ghanaian customers for the home hero (today: AI-generated illustrations) and the custom
  "how it works" illustrations (the current ones are inline SVG placeholders).
- Store listing ids (`NEXT_PUBLIC_IOS_APP_ID`, `NEXT_PUBLIC_ANDROID_PACKAGE`, store URLs) and the WhatsApp business number.
- GA4 property and, if paid social is planned, the Meta and TikTok pixel ids.
