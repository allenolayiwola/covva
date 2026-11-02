# Covva apps and Vercel projects

Covva runs as three Next.js apps in this monorepo, each its own Vercel project on the same Supabase project
(`krmnyqaweawkpygjmdry`).

| App | Folder | Package | Vercel project | Local port | Production domain (planned) |
|---|---|---|---|---|---|
| Marketing site | `apps/site` | `@im/site` | **covva-site** | 3100 | `covva.com.gh` |
| App (portals, quote flow, APIs) | `apps/web` | `@im/web` | **covva-app** (the former `covva` project) | 3102 | `app.covva.com.gh` |
| Admin | `apps/admin` | `@im/admin` | **covva-admin** | 3101 | `admin.covva.com.gh` |

The mobile app (`apps/mobile`) talks to the app's `/api/v1`.

## What lives where

**covva-site** (`apps/site`): every public marketing page: home, explore, insurance and cover pages, bundles,
Learn, support, legal, trust, partners, brokers, insurers, business, diaspora, micro, about, contact, press,
how it works, waitlist, referrals, claims and the service-partner network (and its join form), get started,
verify, plus `sitemap.xml`, `robots.txt`, Open Graph images and icons. It also serves the help chat
(`/api/ai/faq`), policy verification (`/api/public/verify-policy`), the public translation catalogue
(`/api/v1/i18n/{locale}`) and its own `/api/revalidate`. It has no sign-in and no scheduled jobs.

**covva-app** (`apps/web`): sign-in and sign-up, the customer account, the partner workspace, the quote flow
(`/quote`), shared quotes (`/q/{token}`), beneficiary consent links (`/consent/{token}`), invitations, the
embeddable quote widget (`/embed`, `/embed/widget.js`), every `/api/*` route (payments, webhooks, `v1` for
mobile and partners, USSD, AI, cron), the mobile deep-link files under `/.well-known`, and all Vercel crons
(`apps/web/vercel.json`).

**covva-admin** (`apps/admin`): unchanged.

## How the two public apps link to each other

- `siteUrl()` / `sitePath()` and `appUrl()` / `appPath()` in each app's `src/lib/site-url.ts` give the two
  origins (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`). Server-generated links use them: invites, shared
  quotes, consent links, partner offers and payment callbacks go to the app; policy verification QR codes,
  Learn and help-centre links, referral landing links and the embed's "continue" link go to the site.
- **App → site.** App pages link to marketing pages with absolute site URLs. Marketing paths that reach the app
  (old links, indexed URLs) get a permanent redirect (308) to the same path on the site; the app's `/` sends
  signed-in people to `/account` and everyone else to the site home. App pages never `<Link>` or
  `router.push` to `/` (the client's RSC request would follow that cross-origin redirect and fail CORS):
  brand and "back to home" links are plain anchors to `sitePath("/")`, enforced by `tests/unit/origins.test.mjs`.
  The app's `robots.txt` disallows everything.
- **Site → app.** Site pages keep relative links to app paths (`/quote`, `/account/…`, `/sign-in`,
  `/partner/register`…), rendered as plain anchors (`components/app-link.tsx`). The site's proxy forwards those
  paths to the app (307) and appends the visitor's referral (`ref`, `src`, `lead`) from the site's `covva_ref`
  cookie, so the app records the referral on arrival (first touch wins). A prerendered page cannot know the
  visitor's referral, which is why the hop goes through the proxy instead of baking app URLs into the HTML.
- Both proxies refuse to redirect to their own origin, so a missing or wrong URL variable cannot cause a loop.
- The admin posts cache invalidations to both apps' `/api/revalidate` (`apps/admin/src/lib/revalidate.ts`) and
  sends its app calls (bank-transfer confirmation, payment mode, USSD simulator) and app links (invites,
  notifications, CRM) to `NEXT_PUBLIC_APP_URL`, falling back to `NEXT_PUBLIC_SITE_URL` until it is set.

On separate `.vercel.app` hostnames the site cannot see whether someone is signed in (the header always shows
"My account"), and the language choice cookie is per host. Both work across apps once the site is on
`covva.com.gh` and the app on `app.covva.com.gh` (cookies can then be scoped to `.covva.com.gh`).

## Environment variables (names only)

**covva-site**

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Catalogue, partner directory, leads (public reads and RLS inserts) |
| `NEXT_PUBLIC_SITE_URL` | This site's canonical URL (sitemap, Open Graph, robots). While it is a `*.vercel.app` hostname the site asks search engines not to index it; it becomes indexable once this is set to `covva.com.gh` and the site is redeployed |
| `NEXT_PUBLIC_APP_URL` | Where app paths are forwarded |
| `SUPABASE_SECRET_KEY` | The service-partner network join form (writes the application and notifies platform staff) |
| `REVALIDATE_SECRET` | Lets the admin refresh this site's caches |
| Optional: `SITE_GATE`, `SITE_GATE_HOSTS`, `SITE_GATE_BYPASS_TOKEN` | Pre-launch waitlist gate (`docs/MARKETING_SITE.md` §6). Unset = no gate |
| `AI_GATEWAY_API_KEY` (or Vercel OIDC), optional `AI_DEFAULT_MODEL` / `AI_FAST_MODEL` | Help chat |
| Optional: `NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_TIKTOK_PIXEL_ID`, `NEXT_PUBLIC_EXPERIMENTS`, `NEXT_PUBLIC_APP_STORE_URL`, `NEXT_PUBLIC_PLAY_STORE_URL`, `NEXT_PUBLIC_IOS_APP_ID`, `NEXT_PUBLIC_ANDROID_PACKAGE`, `HOME_PARTNER_STRIP_ENABLED`, `LOG_LEVEL` | Same meaning as before the split |
| Optional, for the join-form notification: `RESEND_API_KEY`, `EMAIL_FROM`, `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` | Email/SMS to platform staff; unset means logged only |

**covva-app**: every variable listed for `web` in `docs/OPERATIONS.md` §1, plus `NEXT_PUBLIC_APP_URL` (this
app's URL). `NEXT_PUBLIC_SITE_URL` must be changed to the **site's** URL.

**covva-admin**: as before, plus `NEXT_PUBLIC_APP_URL` (the app). `NEXT_PUBLIC_SITE_URL` becomes the site.

## Switching over (order matters)

1. Create the **covva-site** Vercel project from this repo with root directory `apps/site` and the variables
   above. Check its preview.
2. Rename the `covva` project to **covva-app** (it keeps its root directory `apps/web`, variables, crons and
   webhook URLs). Set `NEXT_PUBLIC_APP_URL` to its URL and `NEXT_PUBLIC_SITE_URL` to covva-site's URL.
3. Set `NEXT_PUBLIC_APP_URL` (and the new `NEXT_PUBLIC_SITE_URL`) on **covva-admin**.
4. Merge the split. Until step 2 is done, the app still treats its own URL as the site and simply does not
   redirect (no loop), so marketing pages would 404 on it: do steps 1–3 first.
5. Later: connect `covva.com.gh` to covva-site and `app.covva.com.gh` to covva-app, update the two URL
   variables in all three projects, and update the Paystack, Hubtel, WhatsApp and Supabase Auth redirect URLs
   to the app domain.

## Local development

```bash
pnpm --filter @im/site dev    # http://localhost:3100
pnpm --filter @im/web dev     # http://localhost:3102
pnpm --filter @im/admin dev   # http://localhost:3101
```

With `NODE_ENV=development` and no URL variables, each app assumes the other runs on these ports.
