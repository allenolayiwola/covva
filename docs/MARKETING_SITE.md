# Marketing site — analytics, experiments, performance and CMS

Status: 28 October 2026. Companion to the "Marketing site (Addendum 5)" section of `docs/ROADMAP.md`.
Everything here lives under `apps/web/src/components/marketing/` and `apps/web/src/app/(site)/(marketing)/`; nothing touches the
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
  element stays static server HTML. Switch it on by setting `NEXT_PUBLIC_EXPERIMENTS=home_hero_headline` on the web project in Vercel and redeploying.

## 4. Lighthouse (production build, mobile emulation)

<!-- LIGHTHOUSE -->

## 5. Home hero carousel

`home-hero.tsx` (server: slide 1's `<h1>`, the art-directed `<picture>`s, the accent font) + `home-hero-carousel.tsx`
(client: rotation, controls, cover picker) + `hero-slides.ts` (copy, suggested cover, images, focus points, provenance).
Timing and the picker's preselection rules are pure functions in `packages/core/src/hero-carousel.ts`.

- Four slides (family, motor claims, home, on your phone) cross-fade every 7 s with a Ken Burns zoom capped at 1.05.
  Rotation pauses on hover, on keyboard focus inside the hero and in hidden tabs; the Pause/Play button covers WCAG 2.2.2.
  `prefers-reduced-motion: reduce` = no autoplay, no zoom, instant swaps (Play opts back in to rotation only).
- One `<h1>` (slide 1) stays in the accessibility tree; later slides swap the visible copy without a live region.
- The picker follows the slide's suggested cover until the visitor picks one; it is a plain GET form to `/quote?category=`.
- The header is transparent with the reverse logo while the home page is at the top (`data-hero-*` rules in `globals.css`).
- Images: 3840px landscape JPEGs plus portrait crops for phones in `src/assets/hero/`, served by `next/image` at quality 85
  (`images.qualities` allows 75 and 85; `deviceSizes` adds 2560). Today they are AI-generated illustrations owned by Covva,
  with no visible credit; replace each with commissioned photography by swapping its two imports in `hero-slides.ts`.
- Contrast: the neutral black scrims keep every hero text run at ≥ 4.5:1 against the brightest pixel under it on all four slides
  (checked from 360px to 2560px wide); recheck when a photo changes.

## 6. Headless CMS — Payload (built)

Payload 3 runs inside the web app: admin at `/cms`, content in the Supabase Postgres schema `cms`, read through the
Local API by `apps/web/src/server/cms.ts` with `'use cache'` + tags and on-publish `revalidateTag`. Pages, Learn
articles, FAQs, testimonials and partner logos are editable; the typed files (`content.ts`, `articles.ts`) remain the
fallback and the seed, so a deployment without the CMS env renders exactly as before. Everything about it — the
version decision, env vars, `cms:migrate` / `cms:seed`, edge protection, preview, translations — is in `docs/CMS.md`.

## 7. Still waiting on assets

- Commissioned photography of real Ghanaian customers for the home hero (today: AI-generated illustrations) and the custom
  "how it works" illustrations (the current ones are inline SVG placeholders).
- Store listing ids (`NEXT_PUBLIC_IOS_APP_ID`, `NEXT_PUBLIC_ANDROID_PACKAGE`, store URLs) and the WhatsApp business number.
- GA4 property and, if paid social is planned, the Meta and TikTok pixel ids.
