# Covva Mobile

Expo SDK 58 customer app (Expo Router, system fonts). Covva is a marketplace: it is never the broker or the insurer.

## What's in the app

- **Sign-in and consent**: Supabase email/password and phone (SMS code) sign-in, then terms/privacy consent.
- **Explore**: browse categories, fill in the risk form and compare quotes.
- **Policies**: policy wallet with details and documents.
- **Account**: profile and sign-out.
- **Requests** is a placeholder tab. **My Cover** is a hidden placeholder route.

The backend is covva-app's mobile API (`apps/web/src/app/api/v1/*`).

## Run locally

From the repository root, run `pnpm install --frozen-lockfile`. Copy `apps/mobile/.env.example` to `apps/mobile/.env.local`, fill in the values, then:

```sh
pnpm --filter @im/mobile start
```

Your phone must be able to reach the web API, so use your computer's LAN IP rather than localhost. Restart Expo after changing environment variables.

Only these public variables are used:

- `EXPO_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: public publishable key. Never put a secret or service key here.
- `EXPO_PUBLIC_API_BASE_URL`: web API URL ending in `/api/v1`.
- `EXPO_PUBLIC_SITE_URL`: website origin for `/legal/terms` and `/legal/privacy`.

Sessions are stored in SecureStore in chunks under 2 KB. Every API request sends `x-covva-client: mobile`. A 401 is retried once after a token refresh, then the app signs out locally.

## Builds (EAS)

`eas.json` has two profiles. Each one reads its variables from the EAS environment of the same name.

- `preview`: internal distribution (an Android APK, plus iOS ad hoc builds) for testing on devices.
- `production`: store builds (Android app bundle). `eas submit` sends Android builds to the Play internal track.

Build numbers are managed remotely and increase automatically. EAS credentials and store accounts are managed in EAS and the store consoles, not in this repo.

## Icons and splash

`assets/` holds the app icon, the Android adaptive icon (foreground plus a monochrome layer for themed icons) and the splash image. All of them are rendered from the brand mark in `packages/tokens/brand/mark.svg`. Re-export them if the mark changes. The icon must stay 1024×1024 with no transparency, which `src/lib/__tests__/app-config.test.js` checks.

## Deep links

- Custom scheme: `covva://<route>`, for example `covva://policies/<id>`.
- Universal links (iOS) and App Links (Android) on `insurance-marketplace-tau.vercel.app` and `app.covva.com.gh`, for `/account*` and `/auth/callback*`.

`src/lib/deep-links.ts` lists the domains, and `app/+native-intent.tsx` maps web paths to app routes:

| Web path | App route |
| --- | --- |
| `/account/policies/<id>` | `/policies/<id>` |
| `/account/policies` | `/policies` |
| `/account/requests/*` | `/requests` |
| `/account/profile` | `/account` |
| anything else under `/account`, and `/auth/callback` | `/` |

The domains must match `ios.associatedDomains` and `android.intentFilters` in `app.json`; a test checks this. Links only open the app once covva-app serves the real verification files on each domain:

- `/.well-known/apple-app-site-association` needs `APPLE_TEAM_ID` set on covva-app.
- `/.well-known/assetlinks.json` needs `ANDROID_SHA256_CERT_FINGERPRINTS` set on covva-app. Include both the EAS upload key and the Play App Signing key.

Both files are prerendered at build time, so redeploy covva-app after setting them. Until then, links open in the browser.

## Checks

```sh
pnpm --filter @im/mobile typecheck
pnpm --filter @im/mobile lint
pnpm --filter @im/mobile test
```

The Jest tests mock auth, fetch and native storage, so they need no network access or credentials.
