# Marketing site — analytics, experiments, performance and CMS

Status: 26 October 2026. Companion to the "Marketing site (Addendum 5)" section of `docs/ROADMAP.md`.
Everything here lives under `apps/web/src/components/marketing/` and `apps/web/src/app/(marketing)/`; nothing touches the
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
- Registered today: `home_hero_headline` (off): it switches the hero lede, not the `<h1>`, so the LCP element stays static
  server HTML. Switch it on by setting `NEXT_PUBLIC_EXPERIMENTS=home_hero_headline` on the web project in Vercel and redeploying.

## 4. Lighthouse (production build, mobile emulation)

<!-- LIGHTHOUSE -->

## 5. Headless CMS — decision needed

The brief asks for a CMS so the marketing team can edit pages, articles, FAQs, testimonials and partner logos without
developers. Today that content is typed TypeScript (`content.ts`, `articles.ts`, `products-content.ts`) plus the partner
directory from the database, which is why the site prerenders and scores well.

| Option | Fits because | Watch out for |
|---|---|---|
| **Payload 3 (recommended)** | Runs inside the Next.js app (`apps/web/src/app/(payload)`), stores content in our existing Supabase Postgres (separate schema), admin UI is React and takes the design tokens, no extra vendor, no per-seat pricing, draft/preview and versions built in, TypeScript types generated from the collections. | Adds ~1 route group and a Postgres schema to the web project; admin users need their own auth (Payload's), or an SSO shim to Supabase Auth; first migration of the typed content takes about a week. |
| Sanity | Hosted, real-time editing, excellent live preview for Next.js, generous free tier. | Another vendor and data residency outside Ghana/UK to assess under Act 843; GROQ learning curve; cost rises with seats and bandwidth. |
| Keep typed content | Zero cost, strongest performance, every change reviewed in a PR. | Every copy change needs a developer; not what the brief asks for. |

Whichever is chosen, the shape is the same: collections for `pages`, `articles` (with `language` for Twi/Ga/Ewe),
`faqs`, `testimonials` (with a `consented` flag; illustrative cards stay until real ones exist), `partnerLogos`, `pressKit`;
`getContent()` helpers behind `"use cache"` with `cacheLife("hours")` and on-demand revalidation from the CMS webhook, so
the pages stay static shells. The existing typed files become the seed data.

**Decision needed from you:** Payload (self-hosted in the web app, data in our Supabase) or Sanity (hosted). Nothing else
on the marketing site waits on it.

## 6. Still waiting on assets

- Real Ghanaian photography and the custom "how it works" illustrations (the current ones are inline SVG placeholders).
- Store listing ids (`NEXT_PUBLIC_IOS_APP_ID`, `NEXT_PUBLIC_ANDROID_PACKAGE`, store URLs) and the WhatsApp business number.
- GA4 property and, if paid social is planned, the Meta and TikTok pixel ids.
