# Covva Mobile

Expo SDK 58 customer app scaffold with Expo Router and system fonts. Explore, My Cover, Requests and Account are placeholders; this PR includes authentication and consent only.

## Run

From the repository root, run `pnpm install --frozen-lockfile`. Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and replace the placeholders locally, then run:

```sh
pnpm --filter @im/mobile start
```

This runs `expo start`. Use a compatible Expo Go installation on an iOS or Android device/emulator. Your phone must be able to reach the web API: use your computer's LAN IP instead of localhost. Restart Expo after changing environment variables.

Only these public variables are used:

- `EXPO_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: public publishable key, never a secret or service key.
- `EXPO_PUBLIC_API_BASE_URL`: web API URL ending in `/api/v1`.
- `EXPO_PUBLIC_SITE_URL`: website origin for `/legal/terms` and `/legal/privacy`.

Enable email/password and phone/SMS authentication in the existing Supabase project. Email sign-up may require confirmation: confirm the email, then return to the app and sign in. Phone sign-in sends an SMS code. Provider setup and delivery are outside this scaffold.

Sessions are stored in SecureStore in Unicode-safe chunks under 2 KB, with a manifest committed after the chunks. AppState starts/stops token refresh. Every API request sends `x-covva-client: mobile`; 401 retries once after refresh, then signs out locally. Rate limits honour Retry-After without automatically replaying writes. Account loading and consent failures block the tabs and offer retry/sign-out. Consent records the versions from `/me` before marking onboarding complete.

No push devices are registered in this PR, so sign-out has no device registration to remove. No EAS configuration or build script is included. Native device smoke testing with configured public credentials is still required before release.

## Checks

```sh
pnpm --filter @im/mobile typecheck
pnpm --filter @im/mobile lint
pnpm --filter @im/mobile test
```

Jest Expo tests mock auth, fetch and native storage; no network or credentials are required.
