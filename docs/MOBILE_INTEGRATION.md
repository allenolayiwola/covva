# Mobile integration guide (Expo / React Native)

Everything the `apps/mobile` app needs from this repo: auth, shared packages, the `/api/v1`
REST API, realtime, uploads, payments, push, deep links and the product rules the app must
honour. The API contract is `docs/api/openapi.yaml` (also served at `GET /api/v1/openapi`).

---

## 1. Environment variables (Expo `EXPO_PUBLIC_*`)

| Variable | Example | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://krmnyqaweawkpygjmdry.supabase.co` | Same project as web |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Publishable (anon) key — safe in the app |
| `EXPO_PUBLIC_API_BASE_URL` | `https://<web-host>/api/v1` | Local: `http://<LAN-IP>:3000/api/v1` |
| `EXPO_PUBLIC_SITE_URL` | `https://<web-host>` | Used for payment `callbackUrl` and web links |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | `…` | Needed by `getExpoPushTokenAsync({ projectId })` |

Never ship `SUPABASE_SECRET_KEY`, Paystack secret keys or `AI_GATEWAY_API_KEY` in the app.

App config (`app.json` / `app.config.ts`): `scheme: "covva"`, iOS
`bundleIdentifier` / Android `package` = `com.covva.app` (or whatever is set in
`IOS_BUNDLE_ID` / `ANDROID_PACKAGE_NAME` on the web project), iOS `associatedDomains:
["applinks:<web-host>", "webcredentials:<web-host>"]`, Android `intentFilters` with
`autoVerify: true` for `https://<web-host>/account/*` and `/auth/callback`.

## 2. Using the monorepo packages

| Package | Use in the app |
|---|---|
| `@im/core` | zod contracts (`CreateRequestInput`, `ApplyInput`, `InitPaymentRequest`, `UploadUrlInput`, …), `riskSchemaToZod()` for quote forms, status metadata (`REQUEST_STATUS`, `QUOTE_STATUS`, `POLICY_STATUS`, `CLAIM_STATUS`, `CATEGORY_AVAILABILITY`), `buildDisclosure()`, `CLAIM_DISCLAIMER`, `DEMO_DISCLAIMER`, `ROLE_STATEMENTS`, `LABELS`, `formatGHS()`, `formatDate()`, `NEEDS_QUESTIONS`, `webPathToDeepLink()`, `DEEP_LINK_SCHEME`, `type ApiResult` |
| `@im/db` | Types only: `Row<"requests">`, `Enum<"request_status">`, `Database` (for `createClient<Database>`), `STORAGE_BUCKETS`, `documentPath()` |
| `@im/tokens` | `colors`, `radii`, `spacing`, `typography`, `tones` — same values as the web Tailwind theme |

Do **not** import `@im/ui` (React DOM) or anything from `apps/web`.

Packages export raw TypeScript (`main: ./src/index.ts`). Metro config for pnpm workspaces:

```js
// apps/mobile/metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;       // pnpm symlinks
config.resolver.unstable_enablePackageExports = true; // honour "exports"
module.exports = config;
```

Add `"@im/core": "workspace:*"`, `"@im/db": "workspace:*"`, `"@im/tokens": "workspace:*"` to
`apps/mobile/package.json`; keep `zod` on the same major as `packages/core` (v4). If hoisting
causes duplicate React, add `node-linker=hoisted` only for the mobile app or use
`resolver.extraNodeModules` to pin `react`/`react-native` to the app's copies.
`riskFingerprint()` uses `crypto.subtle` — the server computes it, the app doesn't need it.

## 3. Authentication (Supabase Auth)

Same Supabase project and RLS as the web. Create one client:

```ts
import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@im/db";

// SecureStore values are limited to ~2 KB; chunk or use a LargeSecureStore (AES key in
// SecureStore, encrypted session in AsyncStorage) for sessions.
export const supabase = createClient<Database>(URL, KEY, {
  auth: { storage: LargeSecureStore, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
// AppState: supabase.auth.startAutoRefresh() when active, stopAutoRefresh() in background.
```

Flows:
* **Email + password** — `signUp({ email, password, options: { data: { full_name, phone, account_type } } })`
  (the `handle_new_user` trigger copies these into `profiles`), `signInWithPassword`.
* **Phone OTP** — `signInWithOtp({ phone: "+233…" })` → `verifyOtp({ phone, token, type: "sms" })`.
* **Email OTP / magic link** — `signInWithOtp({ email, options: { emailRedirectTo: "covva://auth/callback" } })`.
  Handle the deep link: parse `code` → `exchangeCodeForSession(code)` (PKCE), or `token_hash` + `type` →
  `verifyOtp({ token_hash, type })`. Universal link `https://<host>/auth/callback` also opens the app.
* Sign-out: `DELETE /api/v1/devices/{token}` first, then `supabase.auth.signOut()`.

After sign-in call `GET /api/v1/me`. If `needsConsent` is true show terms/privacy and call
`POST /api/v1/me/consents`. Set `PATCH /api/v1/me { onboarded: true }` after onboarding.

## 4. Calling the API

```ts
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${data.session?.access_token}`,
      "x-covva-client": "mobile", // always — see §14 (default is "web")
      ...init.headers,
    },
  });
  const body = (await res.json()) as ApiResult<T>;
  if (!body.ok) throw Object.assign(new Error(body.error.message), body.error, { status: res.status });
  return body.data;
}
```

* `error.code === "forbidden"` (403) with `details.reason === "insurer_web_only"`: the signed-in user is an
  insurer account — show `error.message` and a button to `details.portalUrl` (§14).
* `error.code === "business_rule"` (422): show `error.message` as-is — it is a product rule written for customers.
* `invalid_input` (400): `details: [{ path, message }]` maps to form fields.
* `unauthorised` (401): refresh the session once, then send the user to sign-in.
* `rate_limited` (429): back off for `Retry-After` seconds.
* `unavailable` (503): feature off (AI) or not configured (payments) — hide or explain.
* Send `x-request-id` if you want to correlate logs; every response echoes one.

Reads that RLS already allows (e.g. a realtime-driven refresh of one row) may also go straight to
Supabase with the same client; anything with server logic (create request, apply, pay, upload
confirm, AI) must go through `/api/v1`.

## 5. Screens ↔ endpoints

| Screen | Endpoints |
|---|---|
| Onboarding / consent | `GET /me`, `POST /me/consents`, `PATCH /me` |
| Home | `GET /me`, `GET /requests?open=true`, `GET /policies`, `GET /notifications?unread=true&limit=5` |
| Help me choose | `GET /needs-assessment` (questions), `POST /needs-assessment` |
| Categories | `GET /catalog/categories`, `GET /catalog/categories/{slug}` |
| Get a quote (risk form) | category `risk_schema` → render fields, validate with `riskSchemaToZod`, `POST /requests` |
| Request tracker | `GET /requests/{id}` (timeline, tasks, broker, documents), realtime on `requests`/`request_tasks` |
| Upload a document | `POST /documents/upload-url` → `PUT signedUrl` → `POST /documents` (pass `taskId` to tick the task) |
| Messages | `GET/POST /requests/{id}/messages`, realtime on `request_messages` |
| Compare quotes | `GET /requests/{id}/quotes`; optional `POST /api/ai/quote-summary { quoteId }` |
| Broker disclosure | `POST /requests/{id}/disclosure` (before apply) |
| Apply / declarations | `POST /applications` |
| Pay | `POST /payments` → in-app browser → `GET /payments/{id}` |
| Confirmation | `GET /requests/{id}` + `GET /payments/{id}` (`coverActive` false until issued) |
| Policy wallet | `GET /policies`, `GET /policies/{id}`, `PATCH /policies/{id}`, `GET /documents/{id}/url` |
| Add a policy bought elsewhere | `GET /catalog/insurers`, `POST /policies/external` |
| Renewal | `POST /policies/{id}/renewal` |
| Claims | `GET/POST /claims`, `GET /claims/{id}`, `POST /claims/{id}/withdraw`, `POST /api/ai/claim-completeness { claimId }` |
| Complaints | `GET/POST /complaints` |
| Notifications | `GET /notifications`, `POST /notifications/read` |
| Assistant | `POST /ai/assistant` (stream) |
| Settings | `PATCH /me { notificationPrefs }`, `DELETE /devices/{token}` |

The AI endpoints other than the assistant live at `/api/ai/*` (not `/api/v1`) and accept the same
bearer token: `extract-document`, `claim-completeness`, `quote-summary`.

## 6. Realtime

Tables in the `supabase_realtime` publication: `requests`, `request_messages`, `request_tasks`,
`quotes`, `policies`, `claims`, `notifications`. RLS applies to realtime, so subscribe with the
signed-in client and always filter:

```ts
supabase.channel(`request:${id}`)
  .on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `id=eq.${id}` }, refetch)
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "request_messages", filter: `request_id=eq.${id}` }, onMessage)
  .on("postgres_changes", { event: "*", schema: "public", table: "request_tasks", filter: `request_id=eq.${id}` }, refetch)
  .on("postgres_changes", { event: "*", schema: "public", table: "quotes", filter: `request_id=eq.${id}` }, refetchQuotes)
  .subscribe();

supabase.channel(`user:${userId}`)
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onNotification)
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "policies", filter: `customer_id=eq.${userId}` }, refetchWallet)
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "claims", filter: `customer_id=eq.${userId}` }, refetchClaims)
  .subscribe();
```

Treat realtime payloads as "something changed" signals and refetch through the API (the API adds
labels, disclosure text and hides internal fields). Remove channels when screens unmount.

## 7. Document upload flow

1. `POST /documents/upload-url` `{ scope: "requests", fileName, mimeType, sizeBytes, kind, requestId, taskId? }`
   → `{ path, signedUrl, headers, confirm }`. Allowed types: PDF, JPEG, PNG, WebP, HEIC, DOC/DOCX; max 20 MB.
   Compress photos first (`expo-image-manipulator`, ~1600 px, JPEG 0.7) for low bandwidth.
2. `PUT` the file to `signedUrl` with `headers` (e.g. `FileSystem.uploadAsync(signedUrl, uri, { httpMethod: "PUT", headers })`).
   The URL is valid for 2 hours; retry the PUT on network errors.
3. `POST /documents` with `confirm.body` → the `documents` row. With `taskId` the task is ticked.
4. Optional: `POST /api/ai/extract-document { documentId }` to show "We read these details — please check"
   (labelled AI-extracted, never "verified").

Copy must say uploads go to the broker — **uploading is not the same as notifying the insurer**.

## 8. Payment flow

1. Before applying: show the disclosure from `GET /requests/{id}` (`disclosure`) and call `POST /requests/{id}/disclosure`.
2. `POST /applications { quoteId, declarations, selectedBenefits, acceptTerms: true }`.
3. `POST /payments { applicationId, channel, callbackUrl: "<SITE_URL>/api/payments/return" }`.
   * `authorizationUrl` present → `WebBrowser.openAuthSessionAsync(authorizationUrl, "covva://payments/return")`.
     After checkout Paystack redirects to `/api/payments/return`, which verifies and redirects to
     `covva://payments/return?reference=…&status=…&requestId=…&paymentId=…`, closing the browser.
   * Direct MoMo prompt: pass `momo: { phone, provider: "mtn" | "vod" | "atl" }`; `authorizationUrl` is null —
     show `displayText` ("Approve the prompt on your phone").
4. Poll `GET /payments/{id}` every 3–5 s (max ~2 min, then "We'll notify you") until `final` is true.
5. On success show: **"Payment received. Your cover starts once the insurer confirms acceptance and
   issues documents."** — never "You're covered". `coverActive` turns true only after issuance.
6. In test environments without Paystack keys `authorizationUrl` points to a **sandbox simulator**
   page ("Sandbox simulator · no real money") with succeed/fail buttons; the same return flow applies.

## 9. Push notifications

```ts
const { status } = await Notifications.requestPermissionsAsync();
const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data; // ExponentPushToken[…]
await api("/devices", { method: "POST", body: JSON.stringify({ token, platform: Platform.OS, provider: "expo", appVersion }) });
```

Re-register on every launch (updates `last_seen_at`); unregister on sign-out with
`DELETE /devices/{encodeURIComponent(token)}`. Create an Android channel with id `default`.
Push `data` contains `{ url, path, kind, notificationId, webLink, …ids }` — navigate to `url` on tap
and mark it read with `POST /notifications/read { ids: [notificationId] }`. The server removes
tokens that Expo reports as `DeviceNotRegistered`. Users control channels with
`PATCH /me { notificationPrefs: { push, email, sms } }`.

## 10. Deep links

Scheme `covva://` plus universal/app links on the web host
(`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`, driven by
`APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS`).
`webPathToDeepLink()` in `@im/core` implements this map (it strips `/account`):

| Web path | App link |
|---|---|
| `/account` | `covva://home` |
| `/account/requests/{id}` (and `/confirmation`) | `covva://requests/{id}` |
| `/account/requests/{id}/quotes` | `covva://requests/{id}/quotes` |
| `/account/policies/{id}` | `covva://policies/{id}` |
| `/account/claims/{id}` | `covva://claims/{id}` |
| `/account/complaints/{id}` | `covva://complaints/{id}` |
| `/account/notifications` | `covva://notifications` |
| `/auth/callback?…` | `covva://auth/callback?…` |
| (payment return) | `covva://payments/return?reference=&status=&requestId=&paymentId=` |
| `/partner/offers` | `covva://offers` (broker app only) |
| `/partner/offers/accept/{token}` | `covva://offers/accept/{token}` (broker one-tap accept) |
| `/partner/*` (other), anything else | `covva://notifications` (web-only) |

Expo Router file names should mirror the right-hand column.

## 10a. Broker offers (claim model, Addendum 2 D/E)

New requests are no longer assigned to one broker at creation. The routing engine either sends
the order straight to a connected insurer, fixes the customer's standing broker, or **offers** it
to the best few eligible brokers at once; the first to accept becomes broker of record and the
other offers are withdrawn. Unanswered offers expire after `routing.offer_timeout_minutes`
(default 30) and the next brokers are offered; after the last round the request is held for
platform ops. Customers can also tick "talk to an expert" (`talkToExpert` on `POST /requests`),
which always routes to a broker.

Broker members sign in with the same Supabase session as everyone else. Endpoints (bearer token;
partner API keys with `requests:read` work too):

| Need | Endpoint |
|---|---|
| Open offers with countdown | `GET /partner/offers` (`status=offered` default; `responds_by` drives the timer; `deepLink` / `acceptUrl` per item) |
| History | `GET /partner/offers?status=accepted` (or `declined`, `expired`, `withdrawn`) |
| Accept (one tap) | `POST /partner/offers/{id}` `{ "action": "accept" }` → 200 with `requestId`; 422 `business_rule` if expired, already taken or the member's role may not accept (adviser/supervisor/admin/owner) |
| Decline | `POST /partner/offers/{id}` `{ "action": "decline", "reason"?: "…" }` |

Push notifications of kind `offer.new` carry `data.offer_id`, `data.request_id`, `data.responds_by`,
`data.accept_url` and `data.deep_link` (`covva://offers/accept/{token}`); the SMS/WhatsApp text
contains the same web link. Opening the deep link should show the offer and call the accept
endpoint — never accept silently on open. Realtime: subscribe to `order_offers` filtered by
`broker_org_id=eq.<org>` to refresh the list when an offer is withdrawn or expires. Before an
offer is accepted the request's `risk_data` is visible but the customer's profile is not; after
acceptance the request appears in `GET /partner/requests` as usual.

## 11. Design tokens

Use `@im/tokens`: `colors.brand` (#00796E) for primary buttons and active tabs, `colors.mint` for
secondary buttons/chips, `colors.amberBg`/`colors.amber` for waiting states ("Awaiting document",
"Renewal approaching"), `colors.line` 1 px borders, `radii.lg` (16) cards, Inter font with
`typography.*` sizes. Map status `tone` from `@im/core` metadata (`ok`/`wait`/`neutral`/`danger`/`info`)
to `tones` for pills. Minimum touch target 44 px, 4.5:1 contrast, support 360 px wide screens and
Dynamic Type.

## 12. Rules the app must honour

1. **Technology provider only.** Show `ROLE_STATEMENTS.platform` in onboarding/about; never "we insure you".
2. **Disclosure before application.** Show the broker of record (name + NIC licence) and record the
   acknowledgement before `POST /applications`. Show the mandatory disclosure text on quote, checkout
   and policy screens.
3. **Quote states.** Badge every quote with its `statusLabel` (Estimate / Awaiting underwriting /
   Ready to accept), show `valid_until`, and only offer "Apply" for `ready_to_accept` and unexpired quotes.
4. **Comparison integrity.** Show `summary` (number of quotes and participating insurers), the comparison
   `disclaimer`, explained `labels` only (never an unexplained "best"), paid placements separately and
   labelled, and the time the comparison was made (`comparedAt`).
5. **Never show cover as active until `policy.status === "active"`** (use `coverActive`). Pending
   policies say "Not yet active. Cover starts when the insurer issues the policy."
6. **Claims wording.** Always show `CLAIM_DISCLAIMER`; "Reported to broker" is not approval; only the
   insurer approves, declines or pays.
7. **Category availability** comes from the API (`availability`) — label `broker_assisted` and
   `planned` categories, don't hide them, never hard-code.
8. **Demo badges.** When `flags.demo_mode` / `demoMode` is true or an insurer has `demo: true`, show
   "Illustrative only · Demo data" (`DEMO_DISCLAIMER`) next to insurer names and prices.
9. **AI.** Label assistant and extraction output as AI-assisted ("AI-assisted — check with your
   broker"); never present it as advice or a decision. Respect `flags.ai_assistant` /
   `flags.ai_document_extraction`.
10. **Money and language.** `formatGHS()` for amounts, British English, no promises of instant cover.

## 13. Assistant (streaming)

```ts
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { fetch as expoFetch } from "expo/fetch"; // streaming-capable fetch

const { messages, sendMessage, status } = useChat({
  transport: new DefaultChatTransport({
    api: `${API_BASE}/ai/assistant`,
    fetch: expoFetch as unknown as typeof fetch,
    headers: async () => ({ Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }),
    body: { requestId, threadId },
  }),
});
```

Render `part.type === "text"`; tool parts are `tool-listMyPolicies`, `tool-getPolicyDetails`,
`tool-getRequestStatus`, `tool-explainQuoteComparison`, `tool-explainTerm`, `tool-findCategoryForNeed`,
`tool-draftMessageToBroker` (output `{ draft, requestId, sent: false }` → offer "Open in messages",
the user sends it). Message metadata on start carries `threadId` (also the `x-thread-id` header).

## 14. Workspaces and mobile access (Addendum 4)

Who can use the app:

| User type | Mobile app | Web |
|---|---|---|
| Customer | yes | `/account` |
| Broker user | **yes — same app**, broker workspace | `/partner` (everything, plus bulk import, reports, team) |
| Insurer user | **no** — clear message, link to the web portal | `/partner` (web portal only) |
| Covva staff | no | admin console |

**Identify the client.** Send `X-Covva-Client: mobile` on every `/api/v1` call (the header is also
accepted as `web` and `partner-web`; a missing header means `web`). The server stores the last
value in `profiles.last_seen_platform`.

**Workspaces.** `GET /api/v1/me` returns, besides `profile` / `memberships`:

```jsonc
{
  "workspaces": [
    { "type": "customer", "mobileAllowed": true, "allowed": true },
    { "type": "broker", "orgId": "…", "orgName": "Demo Broker", "role": "adviser", "mobileAllowed": true, "allowed": true },
    { "type": "insurer", "orgId": "…", "orgName": "Coastline General", "role": "underwriter", "mobileAllowed": false, "allowed": false }
  ],
  "activeWorkspace": { "type": "broker", "orgId": "…" },
  "client": "mobile"
}
```

* Every user has the `customer` workspace. One extra entry per active broker/insurer membership.
* `mobileAllowed` is the policy for the mobile app; `allowed` is the policy for the calling client.
* After sign-in: if `workspaces.length === 1` go straight to the customer home. Otherwise show the
  workspace switcher (or open `activeWorkspace`, which is the stored choice when still valid, else
  the first usable partner workspace). A user who is both a broker and a customer switches between
  the two at any time (profile menu → "Switch to my customer account" / "Broker workspace").
* Persist the choice with `POST /api/v1/me/workspace { "type": "broker", "orgId": "…" }` (or
  `{ "type": "customer" }`). It is stored in `profiles.active_workspace` and echoed back by `/me`
  on every device. Choosing a workspace the user doesn't belong to → `403 forbidden`; choosing an
  insurer workspace from the mobile client → `403 forbidden` with the message below.
* Broker screens in the app use the partner endpoints under `/api/v1/partner/*` (requests/orders,
  quotes, policies, claims; accept/decline, documents, messages, renewals and the commission summary
  follow as the web broker workspace is exposed through the API); always scope calls with the
  active `orgId`.

**Insurer users.** An account whose only organisation memberships are insurer (or staff) is refused
on every `/api/v1` call made with `X-Covva-Client: mobile` — including `GET /me` right after
sign-in — so the app can show one clear screen and sign the user out:

```json
{
  "ok": false,
  "error": {
    "code": "forbidden",
    "message": "Insurer accounts are managed in the Covva web portal, not the mobile app. Sign in at https://covva.com.gh/partner on a computer, tablet or phone browser.",
    "details": { "reason": "insurer_web_only", "portalUrl": "https://covva.com.gh/partner" }
  }
}
```

Show `error.message` verbatim with an "Open the web portal" button (`details.portalUrl`) and a
"Sign in with a different account" action. A user who also has a broker membership is **not**
refused: their insurer workspace is simply listed with `mobileAllowed: false` and the app must not
offer it. Nothing about this is a security boundary — RLS is — it is the Addendum 4 product rule.

**MFA.** Broker and insurer users must pass TOTP two-step verification in the **web** partner
workspace. The mobile app does not enforce MFA for the broker workspace in this phase; broker
accounts should enable it on the web (Settings → Security), and the app can read
`supabase.auth.mfa.getAuthenticatorAssuranceLevel()` to show a reminder. Customers use phone OTP
and optional biometrics (device-local) — never TOTP.
