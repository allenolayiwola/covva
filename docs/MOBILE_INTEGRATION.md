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
| Policy wallet | `GET /policies`, `GET /policies/{id}`, `PATCH /policies/{id}`, `GET /policies/{id}/documents`, `GET /documents/{id}/url` |
| Verify a policy (scanner) | `GET /verify?code=…` (public) |
| Add a policy bought elsewhere | `GET /catalog/insurers`, `POST /policies/external` |
| Renewal | `POST /policies/{id}/renewal` |
| Claims | `GET/POST /claims`, `GET /claims/{id}`, `POST /claims/{id}/withdraw`, `POST /api/ai/claim-completeness { claimId }` |
| Complaints | `GET/POST /complaints` |
| Notifications | `GET /notifications`, `POST /notifications/read` |
| Assistant | `POST /ai/assistant` (stream) |
| Settings | `PATCH /me { notificationPrefs, countryCode, preferredCurrency, timezone }`, `DELETE /devices/{token}` |
| Family (diaspora) | `GET /family/dashboard`, `GET/POST /family/beneficiaries`, `GET/PATCH /family/beneficiaries/{id}`, `POST …/consent`, `POST …/consent/confirm`, `POST /family/sponsorships`, `POST /family/sponsorships/{id}/reveal`, `POST /family/claims` (§16) |

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

## 7a. Policy documents and verification

* `GET /policies/{id}/documents` returns every document on the policy with a 15-minute signed URL. Documents
  the platform generated on the insurer's behalf (`generated: true` — `policy_schedule`, `certificate`,
  `sticker` for motor, `receipt`) carry a `sha256`; cache them locally and re-fetch when the hash changes
  (an insurer endorsement can regenerate them). The sticker is an A6 PDF meant to be shown at road checks.
* Every generated document embeds a QR code pointing at `verifyUrl` (`<SITE_URL>/verify?q=<verificationCode>`).
  Show the same QR in the wallet (encode `verifyUrl` with any QR library) with the text "Anyone can scan this
  to confirm the policy is valid — they never see your details".
* Scanner / "check a policy" screen: `GET /verify?code=<10-char code>` or
  `GET /verify?insurer=<slug>&policyNumber=…` — public, no token, rate-limited. The response is deliberately
  minimal (`valid`, `status`, `insurerName`, `categoryName`, `coverStart`, `coverEnd`, `policyNumberMasked`).
  Copy for a negative result: "Not found is not proof of no insurance — the policy may have been bought
  outside Covva."
* Issuance stage and expected time: `GET /requests/{id}` keeps `next_step` current ("Expected to be issued by
  …") and the timeline event `issuance_queued` / `issuance_referred` carries `due_at`. After a final SLA breach
  the event `sla_final_breach` (visible to the customer) means the app must offer the choice — call the web
  request page (`/account/requests/{id}`) or `POST` the Server Action equivalent once exposed in the API.

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

## 8a. Quick motor quote, sharing, bank transfer, WhatsApp opt-in

* **Quick motor quote (3-field start).** Ask for registration, use and value first. `POST /lookups/vehicle
  { registration }` returns `{ found, data: { make, model, year, use … } }` — prefill `vehicle_make`,
  `vehicle_model`, `vehicle_year` (and `use`) and collapse the remaining fields under "Check details".
  `found: false` is normal (no provider configured / not cached): show the fields. Never block on the lookup.
  `@im/core` has `normaliseRegistration`, `quickQuoteFields(riskSchema)` and `prefillFromLookup`.
* **Talk to an expert.** Pass `talkToExpert: true` on `POST /requests` to route to a broker regardless of the
  insurer's integration. Copy: "A licensed broker calls you before any quote is prepared."
* **Honest comparison copy.** From `GET /requests/{id}/quotes` use `comparison.insurersCompared`; when it is 1
  show "1 insurer compared — we show every licensed insurer that quoted for this risk".
* **Save & share.** `POST /requests/{id}/share { channel: "link" | "whatsapp" | "email", email? }` →
  `{ url, whatsappUrl, text, expiresAt }`. Open `whatsappUrl` with `Linking.openURL`, copy `url` to the
  clipboard, or share `text` with the system share sheet. The public page shows no customer identity.
  "Resume later" = the saved request in `GET /requests` (status `quotes_ready` → "Saved quotes").
* **Bank transfer.** `POST /payments { applicationId, channel: "bank_transfer" }` → `authorizationUrl: null`,
  `provider: "bank_transfer"`, `bankTransfer: { bank, accountName, accountNumber, reference, amount, kind,
  instructions }`. Show the details with copy buttons and the reference; the payment stays `pending` until the
  credit is confirmed (poll `GET /payments/{id}` or wait for `payment.succeeded`). Repeating the call returns the
  same instructions. Hubtel checkouts behave like Paystack (`authorizationUrl`), with `provider: "hubtel"`.
* **One-tap renewal.** `POST /policies/{id}/renewal` now returns `renewal: { sameInsurer, alternatives, savings,
  insurersCompared, brokerOrgId }`. Render "Renew with <insurer>" (apply + pay when `sameInsurer.oneTap`) and
  "Switch insurer" (the comparison for `request.id`). The policy's broker stays broker of record.
* **WhatsApp opt-in.** `PATCH /me { notificationPrefs: { whatsapp: true } }` records the opt-in
  (`profiles.whatsapp_opt_in`). Opted-in customers with a phone number get renewal reminders on WhatsApp
  first and SMS only as a fallback. Show the plain copy: "Renewal reminders, quote links and payment links on
  your phone number. We message you only about your cover."
* **Underinsurance nudge.** `GET /policies/{id}` includes `underinsurance_flag` (`{ reason, suggested_sum_insured,
  current_value, at }` or null). Show "Your car may be insured for less than it's worth" with a link to request a change.

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

**Links in WhatsApp messages.** Every link the WhatsApp channel sends (quote links, `/account/requests/{id}`,
`/account/requests/{id}/apply` checkout, `/account/policies/{id}/renew`, `/account/claims/new?policy=…`,
`/account/documents`, broker `/partner/offers/accept/{token}` and `/partner/whatsapp?c=…`) is the plain web
URL on the site host, never a `covva://` URL (WhatsApp only previews https links). The app intercepts them
through universal links / app links (`/.well-known/*` above) and maps them with `webPathToDeepLink()`;
anything it cannot map opens in the in-app browser. Broker one-tap accept also works without the app: the
Accept quick-reply button on the `broker_new_offer` template carries `accept:<token>` and is redeemed by
the webhook (`accept_order_offer(p_token)`), so the app only needs to handle the follow-up notification.

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

## 14a. Claims: messaging, info requests, video, partner network

Everything a claim screen needs beyond `GET /claims/{id}` (Roadmap Phase 2). Reporting a claim is still not
approval — only the insurer decides — and the screens must say so (`disclaimer`).

**Report with location and a police report**

```http
POST /api/v1/claims
{ "policyId": "…", "incidentType": "accident", "incidentAt": "2026-10-20T08:30:00Z",
  "location": { "lat": 5.6037, "lng": -0.187, "accuracy": 12, "address": "Spintex Road, Accra" },
  "description": "…", "amountClaimed": 1500, "policeReportDocumentId": "…" }
```

`location` may still be a plain string. Upload the police report first with `POST /documents` (kind `police_report`)
and pass its id; photos go through `/documents` with `claimId`.

**Timeline with expected times** — `GET /claims/{id}/timeline` returns `stages[]`
(`reported → acknowledged → assessing → decision → payment`) with `state` done | current | upcoming, `at` when reached,
or `expectedBy` / `expectedLabel` (acknowledged within 24 h, assessment about 5 working days, payment within 10 working
days of approval) and `overdue`. Show `next.message` under the status; never an open-ended "processing".

**Thread** — `GET /claims/{id}/messages` (oldest first; `canMessage` false once the claim is closed) and
`POST /claims/{id}/messages { "body", "attachments": [{ "documentId", "name" }] }`. Customers never receive internal
partner notes. Subscribe to `claim_messages` (`claim_id=eq.<id>`) over Realtime (§6) for live updates. Push kind `claim.message`.

**Information requests** — `GET /claims/{id}/info-requests` lists what the insurer or broker asked for (`kind`
document | information | inspection, `message`, `due_at`). Answer with
`POST /claims/{id}/info-requests/{reqId}/fulfil { "documentId"?: "…", "response"?: "…" }` (upload the file with
`/documents` first). Push/SMS kind `claim.info_requested` carries `info_request_id`; deep link to the claim screen and
open the request.

**Video** — `POST /claims/{id}/video` as `multipart/form-data` with a `file` part (`fileName`, `mimeType`,
`durationSeconds`, `caption`) or JSON with base64 `content`. Limits: 90 seconds, 50 MB, MP4/WebM/QuickTime
(`MAX_VIDEO_SECONDS`, `MAX_VIDEO_BYTES`, `validateClaimVideo` in `@im/core`). Read the duration from the picker and
check it before uploading; the server rejects longer clips with `400 invalid_input`. The video appears in
`GET /claims/{id}` documents as kind `claim_video` with `duration_seconds`.

**Partner network** — `GET /service-partners?kind=garage&region=Greater%20Accra&insurerOrgId=<claim.insurer_org_id>`
(public) lists approved garages, towing, hospitals, clinics, pharmacies and assessors; `directBilling: true` means the
partner settles with that insurer and the customer pays nothing upfront — show "Direct billing — you don't pay upfront".
Use `partnerKindsFor(categorySlug, incidentType)` from `@im/core` to choose the kinds for a claim.
`GET /claims/{id}/jobs` shows the repair/towing/treatment jobs the broker or insurer arranged (`status`
requested → accepted → in_progress → completed, partner contact details, `direct_billing`, `directBillingNote`).
Push kind `claim.job`.

Broker app: `POST /partner/claims/{id}/info-requests` and `POST|PATCH /partner/claims/{id}/jobs` (see §15.3).
Fraud indicators exist for the insurer's claims team and platform staff only; the API never returns them to customers or brokers.

## 15. Broker workspace (mobile) — Addendum 4 §2

Everything the broker workspace needs on the phone lives under `/api/v1/partner/*` and works with the
broker user's bearer token (RLS applies; the database analytics functions also check membership).
Send `X-Covva-Client: mobile` and, for users who belong to several organisations, the organisation
with `?orgId=` or the `X-Covva-Org` header (otherwise the stored `activeWorkspace` from `/me` is used,
then the only partner membership). An insurer workspace is refused on mobile with
`details.reason = "insurer_web_only"` (§14). The same endpoints serve the web partner workspace and
partner API keys (scopes `requests:read`, `policies:read`, `claims:read`, `finance:read`).

| Screen | Endpoint | Notes |
|---|---|---|
| Home | `GET /partner/dashboard?days=30` | KPIs, sparkline series, open counts, renewals due, claims, SLA, commission (finance roles) |
| Orders (offers) | `GET /partner/offers`, `POST /partner/offers/{id}` | §10a — accept / decline, one-tap deep link |
| Order details | `GET /requests/{id}`, `GET /requests/{id}/quotes` | Customer identity only after accepting |
| Documents (camera) | `POST /partner/documents` | One call, base64 or multipart; links to a request / policy / claim |
| Client messaging | `GET/POST /partner/messages?request_id=` | Push to the customer; `internal: true` for team notes |
| Claims | `GET /partner/claims`, `POST /partner/claims/{id}/updates` | Steps a broker may record; decisions are insurer-only |
| Clients | `GET /partner/customers`, `GET /partner/customers/{id}` | Brokers only |
| Renewals | `GET /partner/renewals?days=30` | With contact-permission flags |
| Commission & statements | `GET /partner/commission?period=YYYY-MM`, `GET /partner/statements`, `GET /partner/statements/{id}` | Owners, admins, finance |
| Profile & insurer links | `GET /partner/profile`, `PATCH /partner/profile` | Appointments per product line; contact fields editable by owners/admins |

The full request/response shapes are in `docs/api/openapi.yaml` (`/partner/*`) and the zod contracts
in `packages/core/src/api.ts` (`PartnerDashboardQuery`, `PartnerClaimUpdateInput`, `PartnerMessageInput`,
`PartnerDocumentUploadInput`, `UpdatePartnerProfileInput`).

### 15.1 Dashboard

```http
GET /api/v1/partner/dashboard?days=30
Authorization: Bearer <token>
X-Covva-Client: mobile
```

```jsonc
{
  "ok": true,
  "data": {
    "org": { "id": "…", "name": "Demo Broker", "type": "broker", "role": "adviser" },
    "range": { "days": 30, "from": "2026-09-27", "to": "2026-10-26" },
    "kpis": { "requests": 42, "quotes": 61, "conversions": 18, "policiesIssued": 15, "premium": 48250, "platformFee": 0, "brokerCommission": 6031.25,
              "conversionRate": 29.5, "change": { "requests": 12.5, "quotes": -3.2, "conversions": null, "policiesIssued": 7.1, "premium": 9.8, "platformFee": null, "brokerCommission": 4 } },
    "series": [{ "day": "2026-09-27", "requests": 2, "quotes": 3, "conversions": 1, "policies_issued": 1, "premium": 1200, "platform_fee": 0, "broker_commission": 150 }, "…"],
    "open": { "offers": 3, "requests": 11, "submissions": 0, "claims": 2 },
    "renewals": { "count": 6, "windowDays": 30, "next": ["… first 10 partner_renewals rows …"] },
    "claims": { "byStatus": { "reported": 1, "under_assessment": 1, "paid": 4 }, "total": 6, "open": 2, "decided": 4, "avgDaysToDecision": 5.5, "staleOpen": 0, "openSlaBreaches": null },
    "sla": { "requests_measured": 30, "requests_on_time": 27, "requests_breached": 3, "requests_open_overdue": 1, "submissions_measured": 20, "submissions_on_time": 18, "submissions_late": 2, "submissions_open_overdue": 0, "on_time_rate": 90.0 },
    "lapses": { "lapsed": 1, "cancelled": 0, "expired": 2, "renewed": 9, "active": 120, "ended": 12, "lapse_rate": 25.0 },
    "commission": { "period": "2026-10", "earned": 6031.25, "paid": 0, "outstanding": 6031.25, "revenue_share": 1206.25, "platform_fee": 0, "entries": 15, "statement_id": null, "statement_status": null, "statement_net_due": null, "currency": "GHS", "period_start": "2026-10-01", "period_end": "2026-10-31" },
    "commissionVisible": true,
    "period": "2026-10"
  }
}
```

`commission` is `null` and `commissionVisible` is `false` for advisers and viewers — hide the tile rather
than showing zeros. `change` values are percentages versus the previous window (`null` = nothing to compare).

### 15.2 Renewals

`GET /partner/renewals?days=30` → `{ windowDays, count, items: [...] }`. Each item:

```jsonc
{ "policyId": "…", "reference": "POL-2026-000123", "policyNumber": "CG/MTR/2026/0123", "category": { "id": "…", "name": "Motor" },
  "coverEnd": "2026-11-12", "daysLeft": 17, "premium": 1450, "currency": "GHS", "status": "active",
  "customer": { "id": "…", "name": "Ama Mensah", "email": "ama@…", "phone": "+233…" },
  "contactAllowed": true, "marketingAllowed": false,
  "renewalRequest": null, "remindersSent": 1 }
```

Only contact the customer when `contactAllowed` is true (latest `data_sharing_broker` consent). Start
the renewal with `POST /policies/{id}/renewal` on behalf of the customer only through the web request
form; from the app, message the customer (`POST /partner/messages`) and let them confirm. Any renewal
price is an estimate until the insurer confirms it.

### 15.3 Claims updates

```http
POST /api/v1/partner/claims/{id}/updates
{ "status": "delivered_to_insurer", "note": "Photos and police report sent to Coastline.", "visibleToCustomer": true }
```

Allowed `status` values for brokers: `delivered_to_insurer` (from `reported`), then `acknowledged`,
`under_assessment`, `info_requested` — but only while the insurer has not recorded anything on the
claim; afterwards the call returns `422 business_rule` and you should send a note only (`{ "note": "…" }`).
Approve / reject / pay never come from the broker app. Response `201 { claim: { id, reference, status, statusLabel }, event }`.

Information requests and partner jobs: `POST /partner/claims/{id}/info-requests { "kind": "document", "requestedParty": "customer", "message": "…", "dueAt"? }`
notifies the customer (push, in-app, email, SMS). `POST /partner/claims/{id}/jobs { "servicePartnerId", "kind": "repair", "directBilling": true, "estimate"?, "scheduledFor"?, "notes"? }`
assigns an approved partner from `GET /service-partners?insurerOrgId=` (direct billing only where the partner direct-bills the claim's insurer);
`PATCH /partner/claims/{id}/jobs { "jobId", "status" }` tracks it. Both also work for insurer users on the web.

### 15.4 Documents from the camera

```http
POST /api/v1/partner/documents
Content-Type: application/json
{ "fileName": "schedule.jpg", "mimeType": "image/jpeg", "kind": "policy_schedule", "policyId": "…",
  "content": "data:image/jpeg;base64,/9j/4AAQ…", "deliveredToInsurer": false }
```

or `multipart/form-data` with a `file` part and the same fields. Response `201 { document: { id, kind, file_name, … } }`.
Link every upload to exactly the record it belongs to (`requestId`, `policyId` or `claimId`); the server
checks the organisation services it. Files over 20 MB must use the two-step flow in §7.

### 15.5 Messaging

`GET /partner/messages?request_id=…` returns the thread oldest-first, including `internal` notes the
customer never sees, and marks the customer's messages as read by the broker.
`POST /partner/messages { "requestId", "body", "attachments": [{ "documentId", "name" }], "internal": false }`
sends a push + in-app + email to the customer (`message.new`). Subscribe to `request_messages` over
Realtime (§6) for live updates.

### 15.6 Push notification payloads the broker app must handle

Every push has `data = { url, path, kind, notificationId, webLink, …ids }` (§9). Partner web paths map to
`covva://notifications` (`url`), so **route by `kind` and the ids** instead of `url` for these:

| `kind` | When | `data` | Open |
|---|---|---|---|
| `offer.new` | A request was offered to the broker (claim model) | `{ offer_id, request_id, round, responds_by, accept_url, deep_link }` + `url = covva://offers/accept/{token}` | Offer screen (one-tap accept) |
| `request.created` / `request.assigned` | A request was routed / assigned to you | `{ request_id }` | Order details |
| `message.new` | The customer sent a message | `{ request_id, message_id }` | Thread |
| `document.uploaded` | The customer uploaded a document | `{ request_id, document_id }` | Order documents |
| `claim.reported` | A customer reported a claim on a policy you service | `{ claim_id }` | Claim |
| `claim.status` | The insurer (or your team) changed a claim's status | `{ claim_id, status }` | Claim |
| `renewal.due` | The renewals cron found policies ending soon (per policy, at the configured reminder days) | `{ policy_id, days }`, `webLink = /partner/renewals` | Renewals list |
| `submission.*`, `quote.*`, `policy.issued`, `payment.succeeded` | Progress on an order | `{ request_id, … }` | Order details |

Mark the notification read with `POST /notifications/read { ids: [notificationId] }` after navigating.
`BROKER_PUSH_KINDS` in `@im/core` lists the kinds above.


## 16. Diaspora: family, beneficiaries, consent, gifts, proxy claims

Sponsors abroad (UK, US, Canada, EU, Australia) buy and manage cover for family in Ghana. `GET /me` now
returns `country` (ISO-2, `GH` = home), `currency`, `timezone`, `isSponsor` and `household`
(`{ id, name, beneficiaries }` or `null`). Sign-up asks for the country; `PATCH /me { countryCode }`
changes it (currency and time zone follow the country unless given).

### 16.1 Beneficiaries and consent

```http
POST /api/v1/family/beneficiaries
{ "fullName": "Akua Mensah", "relationship": "parent", "phone": "024 123 4567", "dateOfBirth": "1958-03-02" }
→ 201 { "beneficiary": { "id": "…", "consent_status": "pending", "ghana_card_masked": null, "has_account": false, … },
        "nextStep": "Send a consent code…" }
```

Consent is captured **from the beneficiary**, never typed in by the sponsor:

```http
POST /api/v1/family/beneficiaries/{id}/consent        { "kind": "data_sharing", "channel": "sms" }
→ { "sentTo": "+2332***567", "expiresAt": "…", "channel": "sms", "delivered": true, "message": "We sent a code to …" }
```

The beneficiary's phone receives a 6-digit code **and** a signed link (`/consent/{token}`, valid 7 days, no
login) showing who is asking and what is shared with Accept / Decline. Either the beneficiary reads the code
to the sponsor, who confirms it:

```http
POST /api/v1/family/beneficiaries/{id}/consent/confirm  { "kind": "data_sharing", "code": "123456" }
→ { "status": "granted", "grantedAt": "…", "beneficiary": { …, "consent_status": "granted" } }
```

or taps the link. A wrong code returns `400 invalid_input` ("That code is not right. 3 attempt(s) left."); the
fifth wrong code locks it (`422 business_rule`, "Too many incorrect codes…") until a new one is sent. Codes
expire after 15 minutes (`422`, "That code has expired").
Kinds: `data_sharing` (needed before any quote for them), `proxy_claims` (claims on their behalf),
`policy_purchase`. Show `consent_status` with the labels in `CONSENT_STATUS` (`@im/core`).

If the beneficiary later signs up with the same phone number, their account is linked automatically
(`linked_user_id`, `has_account: true`): they then see the policy in their own wallet with "Paid for by
<sponsor first name>" and get in-app/push updates instead of SMS.

### 16.2 Requesting cover for a family member

`POST /requests` accepts `beneficiaryId`. The request carries `sponsor_user_id` (the caller) and
`beneficiary_id`; create the sponsorship right after so gifts and dual notifications apply:

```http
POST /api/v1/family/sponsorships
{ "beneficiaryId": "…", "requestId": "…", "gift": true, "giftMessage": "Happy birthday Mum ❤️", "notifyBeneficiary": true }
→ 201 { "sponsorship": { "status": "draft", … } }
```

The sponsorship becomes `active` when the insurer issues the policy (`policy_id` set). Payment and currency
choice are unchanged (§8); multi-currency checkout lives in the payments stream.

### 16.3 Family dashboard

`GET /family/dashboard` → `{ summary, beneficiaries[+consents], sponsorships, policies, claims, payments, subscriptions }`.
`summary` = `{ activePolicies, pendingPolicies, nextRenewal: { policyId, coverEnd, days } | null,
nextPaymentDue | null, openClaims, annualPremiumGHS, coverGaps: [{ beneficiaryId, name, reason }] }` —
`reason` is `consent_pending`, `consent_declined` or `no_cover`; render each as a next-step card.
Compute it offline with `familyDashboardSummary()` from `@im/core` if you cache rows.

### 16.4 Gifts

A gifted policy stays a surprise: the beneficiary is not told at issuance. The sponsor hands it over
(web: "Hand over the gift now"; the beneficiary gets `gift.received` with `link = /account/gifts/{sponsorshipId}`).
The beneficiary's app opens it with `POST /family/sponsorships/{id}/reveal` → `{ giftMessage, giftRevealedAt, policyId }`
(the sponsor gets `422` here). Show `sponsorLine(firstName, gift)` ("A gift from Kofi" / "Paid for by Kofi")
on the policy screen; the first name comes from the `policy_sponsor_name` RPC or `GET /policies/{id}`.

### 16.5 Claims by proxy

```http
POST /api/v1/family/claims
{ "policyId": "…", "incidentType": "hospital_admission", "incidentAt": "2026-10-20T09:00:00Z",
  "description": "Mum was admitted to KATH with …", "evidence": [{ "path": "<sponsorId>/claims/…jpg", "name": "bill.jpg", "mime": "image/jpeg" }] }
→ 201 { "claim": { "id", "reference", "status": "reported", … }, "beneficiary": { "id", "full_name" }, "reportedBy": "<sponsorId>",
        "requiredEvidence": [...], "disclaimer": "…", "warnings": [] }
```

Requires an active sponsorship on that policy and the beneficiary's `proxy_claims` consent; otherwise
`422 business_rule` with a message to show ("Ask your family member to consent…") or `403` when the caller does
not pay for the policy. The claim belongs to the policyholder (`customer_id`) with `reported_by_user_id` = sponsor;
both see it under `GET /claims/{id}` and both receive status updates.

### 16.6 Dual notifications

Every policy event (`policy.issued`, `renewal.reminder`, `claim.reported`, `claim.status`, `gift.received`,
`consent.granted` / `consent.declined` for the sponsor) reaches the sponsor **and** the beneficiary. Rows carry
`recipient_role` (`sponsor` | `beneficiary` | `customer`) and `data.recipient_role`; a beneficiary without an
account gets SMS/WhatsApp instead. `FAMILY_PUSH_KINDS` in `@im/core` lists the kinds; route `consent.*` to the
beneficiary's page (`data.beneficiary_id`) and `gift.received` to the gift screen (`data.policy_id` + link).

## 16. Diaspora payments: currencies, subscriptions, bundles, property cover

Rules first: the **GHS amount is the contract amount the insurer receives**. Anything in GBP/USD/EUR/CAD is an
indicative display — always show the disclosure text the API returns and never a bare foreign figure.

* **Currency selector.** `GET /fx?currency=GBP&amount=<GHS>` (no auth) → `rates` per currency (`rate` = GHS per
  1 unit, `source`, `fetchedAt`, `manual` flag), `marginPct`, and `quote` (`displayAmount`, `disclosure`). Default the
  selector to `profile.preferred_currency` when present, else GHS. Render the checkout line as
  **"You pay ≈ £X (indicative) · Insurer receives GH₵ Y"** plus `quote.disclosure`. When `manual` is true add
  "rate set by Covva operations — a guide only". `@im/core` has `convertFromGhs`, `fxQuote`, `fxDisclosure`,
  `formatMoney` for offline formatting.
* **Paying.** `POST /payments { applicationId, channel: "card", displayCurrency: "GBP", saveMethod?: true,
  sponsorSubscription?: { cadence: "monthly" | "annual" } }`. Foreign currency and sponsor plans are **card only**
  (`mobile_money` / `bank_transfer` → 400). The response adds `fx` (the quote stored on the payment), `psp`
  (`paystack_intl` for foreign cards) and `sponsorSubscription` (`chargeAmount` = the first instalment, `quotedTotal`).
  The hosted page is Paystack's: the card is charged the GHS amount and the issuer converts (Apple Pay / Google Pay
  appear when the business has the channel enabled). `GET /payments/{id}` returns `display_currency`,
  `display_amount`, `fx_rate`, `fx_source`, `psp` alongside the GHS `amount`.
* **Sponsor subscriptions.** `GET /subscriptions` → `items[]` (with `summary.amountLabel`, `nextChargeLabel`,
  `tone`) and `paymentMethods[]` (brand, last4, expiry — never a PAN). `POST /subscriptions { policyId, cadence,
  displayCurrency, paymentMethodId? }` needs a saved method (pay once by card with `saveMethod: true`, or use
  `sponsorSubscription` at checkout, which creates the subscription automatically after `charge.success`).
  `POST /subscriptions/{id}/pause` and `/cancel { reason? }`. Statuses: `active`, `past_due` (collections failed after
  1d/3d/7d retries — show "update your card"; the insurer keeps cover for its grace period and decides on lapses),
  `paused`, `cancelled`. Notification kinds: `subscription.created`, `payment.succeeded` (each collection),
  `payment.failed`, `subscription.past_due`, `subscription.paused`, `subscription.cancelled` → deep link
  `/account/payments/subscriptions`. Copy to keep: "Pausing or cancelling does not cancel the policy — the insurer
  decides on lapses."
* **Bundles.** `GET /bundles` (no auth) → published packs with `items[]` (`category_slug`, `required`), `quote`
  (indicative GHS `total`, `complete`, `missing[]`) and `getStartedUrl`. In the app, start a request for the first
  item (`POST /requests`), then create the other items as requests when the customer is ready; the web flow does the
  same with `?bundle=` (siblings saved as drafts). The discount is indicative until the insurer confirms it.
* **Property cover (home being built).** For policies in a home/property category: upload a site photo with the
  documents flow (`POST /documents/upload-url { scope: "policies", policyId }` → PUT), then
  `POST /property/{policyId}/updates { storagePath, caption?, takenAt? }`; `GET …/updates` lists them (customer,
  sponsor, broker and insurer can see them). `POST /property/{policyId}/inspections { address, gps?, notes? }` asks
  for a partner site visit (one open inspection per policy → 409); `GET …/inspections` shows `status`
  (`requested` → `assigned` → `scheduled` → `completed` | `failed`), `scheduled_for`, `report`, `photos`.
  Notifications: `inspection.assigned`, `inspection.scheduled`, `inspection.completed`. Copy: "The insurer decides
  what the report means for your cover."

## Referrals

Customers get a personal referral link (8-character base32 code). Anyone opening `https://covva.com.gh/<path>?ref=CODE`
gets a first-party `covva_ref` cookie for 30 days and the next request they create is attributed to the code. In the app,
let users share the link and show their friends and credits:

* `GET /api/v1/me/referrals` → `{ link: { code, url, landing_path } | null, friends: [{ attribution_id, joined_at, converted_at, rewarded }], credits: [{ kind, amount, expires_at, created_at }], balance, currency, programmeActive, note }`.
  Friends are anonymous — never show names. `programmeActive = false` means rewards are not switched on yet (they need
  NIC and insurer approval); say so honestly.
* `POST /api/v1/me/referrals` → creates (or returns) the link; same response shape.
* Share via WhatsApp (`https://wa.me/?text=…`), SMS (`sms:?&body=…`) or copy.
* Credits are GHS credit units, **not cash**: they only come off Covva's platform fees, or a future premium where the
  insurer funds the discount. Show `note` wherever credits appear. Referrals never change quotes or their order.
* Attribution uses the web `covva_ref` cookie, so it applies to requests created on the website (including the web views
  the app opens). Requests created natively in the app are not attributed yet. A customer cannot refer themselves.

## Instalments and micro cover

Phase 3. Every payment is a GHS premium payment to the **insurer** (Covva never holds the money). Mobile money payments
send a prompt the payer approves with their PIN — show `displayText` and poll `GET /payments/{id}` (or wait for the
`payment.succeeded` / `payment.failed` push) rather than assuming success.

**Instalments**

* `GET /policies/{id}/instalments` → `{ schedule | null }` with `summary` ("Instalments: 3 of 12 paid · next GH₵ 85.00 on
  5 Dec 2026"), `state` (`current | due | grace | overdue | lapsed | completed | cancelled`, `arrears`, `next`,
  `graceUntil`, `lapseAt`), `rules` (the insurer's grace / lapse / reinstatement rules in plain words — show them) and
  `instalments[]`.
* `POST /instalments/{id}/pay` `{ channel: "mobile_money" | "card" | "link", momo?: { phone, network: mtn|vod|atl }, paymentMethodId? }`
  → `{ paymentId, status, authorizationUrl, displayText, amount }`. Earlier unpaid instalments are included. `link`
  returns a hosted checkout to open in an in-app browser.
* `POST /instalments/schedules/{id}/reinstate` (same body) on a lapsed schedule within the window →
  `requiresReview: true` means the insurer reviews before cover resumes (tell the customer; a decline is refunded).
* Choosing a plan at checkout is on the web checkout today (`instalment_plan` on the apply step); the app can open the
  web checkout. Push kinds: `instalments.created`, `instalments.grace`, `instalment.due` (pay link), `policy.lapsed`,
  `instalments.reinstatement_pending`, `instalments.reinstated`, `instalments.reinstatement_declined`,
  `payment.succeeded`, `payment.failed`.

**Micro cover**

* `GET /micro/products?audience=okada|trotro|ride_hailing|trader|artisan|event` (no auth) → `items[]` with `byPeriod`
  and `fromLabel` ("from GH₵ 2.50/day").
* `POST /micro/buy` `{ productVersionId, period: day|week|month, channel: "app", payment: "mobile_money" | "card", momo?, autoRenew? }`
  → `mode: "instant"` with `payment` (MoMo prompt or `authorizationUrl`) and `quoteText`, or `mode: "routed"` with the
  `requestId` a broker / the insurer quotes (show "We'll confirm your quote").
* `POST /micro/{policyId}/renew` `{ period?, channel, momo?, paymentMethodId? }` — one tap; the new window starts when the
  current one ends (`startsAt`, `endsAt`).
* `PATCH /micro/{policyId}` `{ autoRenew }`. Push kinds: `micro.renew_link`, `payment.succeeded`, `payment.failed`.
* Cover is live only while the policy is `active`; a paid window on a `pending_issuance` policy is "Issuing".


## Business accounts

SME & group (Phase 3). A business account is an organisation of type `enterprise`; the user's role in it is
`owner | admin | finance | viewer` (owners/admins manage everything, finance pays statements, viewers read the
dashboard). Business memberships are **not** partner workspaces — they never appear in `GET /me` `workspaces` and the
app stays in the customer workspace. All endpoints below use the customer's bearer token (`X-Covva-Client: mobile`).

* `GET /business` → `{ accounts[], workplaceCover[] }`. `accounts[]` = `{ orgId, name, role, team, profile }`; show a
  "Business" entry in the account tab when it is non-empty. `workplaceCover[]` is the user's own cover as a scheme member
  (employer, scheme, insurer, renewal). Calling it also links census rows whose phone matches the user's **verified**
  sign-in phone.
* `POST /business` `{ name, industry, employees, billing_email, billing_contact, tin?, registration_number?, phone?, region?, address? }`
  → `201 { orgId }`; the caller becomes owner (max 5 owned accounts → `422`).
* `GET /business/{orgId}/dashboard` → schemes (status, member count, renewal), member / fleet / asset counts, renewals in
  the next 60 days, statements due, open requests and **counts** of employee claims (never claim details).
* `GET /business/{orgId}/members[?schemeId=]` → per scheme `{ scheme, categoryName, census, broker, insurer, members }`.
  `members` is `null` for finance and viewer roles — render the census counts only.
* `POST /business/{orgId}/members` `{ schemeId, full_name, relationship, principal_member_id?, date_of_birth?, phone?, … }`
  (owner/admin). Only the last 4 Ghana Card digits are stored; dependants need `principal_member_id`.
* `POST /business/{orgId}/members/import` `{ schemeId, csv, mode: "preview" | "import" }` → `{ valid, errors: [{ row, message }], preview[], inserted, skipped[] }`.
  Always call `preview` first and show the row-numbered problems; `import` writes only the valid rows. Template columns:
  `employee_ref, full_name, date_of_birth, gender, phone, email, ghana_card, relationship, principal_ref, cover_tier, salary_band`.
* `GET /business/{orgId}/fleet`; `POST /business/{orgId}/fleet` with one vehicle `{ registration, make?, model?, year?, value?, use, driver_name? }`
  (`201`) or `{ csv, mode }` for a bulk upload (same report shape as members). Registrations come back normalised (`GR 1234-23`).
* `GET /business/{orgId}/invoices` → consolidated statements with `lines[]` (`description, amount, insurer_name, basis, payment_status`).
* `POST /business/invoices/{id}/pay` `{ channel, momo?: { phone, provider }, insurerOrgId? }` → `results[]` — **one payment
  per insurer line**. For each result open `authorizationUrl` (card / hosted MoMo) or tell the user to approve the MoMo
  prompt; `not_collected` lines are premiums the insurer collects directly (show `message`). Copy: "Each insurer is paid
  directly — Covva never holds your premiums."

Group schemes, fleets, property and liability are always handled by a licensed broker: quote requests are created on the
web (or by the broker) from the census summary — counts only, never member names or contact details. Push kinds:
`business.invoice.issued`, `business.member.added`, plus the usual `request.*` / `quote.ready` for business requests.

## Locales, USSD fallback and voice notes

**Language.** Send the user's choice on every request as `X-Covva-Locale: tw` (or rely on `Accept-Language`); the
server resolves `X-Covva-Locale` → profile → `Accept-Language` → English. Supported codes: `en`, `tw` (Twi), `gaa` (Ga),
`ee` (Ewe); `ga`, `twi`, `ak` and `en-GH` are accepted aliases.

* Bundle the English catalogue (`packages/core/src/i18n/en.ts` — the source of truth, same keys as the web) and fetch
  `GET /api/v1/i18n/{locale}` (public, cached ~1 h) on start-up and when the language changes. `messages` contains only
  approved, human-translated keys: render `messages[key] ?? en[key]`, interpolating `{name}` / ICU-light
  `{count, plural, one {…} other {…}}` (use `createTranslator` from `@im/core` if you share the package).
* `status` is `planned` | `partial` | `complete`. For anything but `complete`, show
  "<Language> translations are in progress — untranslated text is shown in English." Never machine-translate.
* Save the choice for signed-in users with `PUT /api/v1/me/locale { locale }` (stored in `profiles.locale`, read back in
  `GET /api/v1/me`).

**USSD fallback.** For customers without data, the app can show "No data? Dial `*920*44#`" (`USSD_SERVICE_CODE`; the
code is aggregator-dependent until the NCA short code is live). USSD covers quote (motor third-party, micro, funeral),
renew, pay an instalment, check a policy, a claim callback and "talk to us"; it identifies the customer by the phone
number on their profile, so ask users to keep it current.

**Voice notes.** Offer "Describe what happened by voice" on the claim report and "Explain what you need" on a request:

1. Record ≤ 120 s (AAC/M4A `audio/mp4` on iOS, `audio/webm`/`audio/ogg` or M4A on Android), ≤ 10 MB.
2. `POST /api/v1/voice-notes` — multipart (`file`, `purpose` = `claim_description` | `quote_help` | `support`,
   `durationSeconds`, `languageHint` = `en`|`tw`|`gaa`|`ee`, optional `requestId`/`claimId`) or JSON
   `{ audioBase64, mimeType, purpose, … }`. Response 201 with `voiceNote.transcriptStatus = "pending"`.
3. Poll `GET /api/v1/voice-notes/{id}` (every 2–3 s, give up after ~90 s) until `done` or `failed`.
4. Show the transcript in an editable field labelled **"Automatic transcript — please check"** (add "less accurate
   for Twi, Ga and Ewe" when `lowerAccuracy` is true). Save corrections with `PATCH /api/v1/voice-notes/{id}`.
5. Only when the user taps "Add to my description", append the text to the claim description / request note. Never
   submit automatically. `failed` with `failureReason = "transcription_disabled"` means the note is saved but there is
   no transcript — the broker can still listen (`audioUrl`, a 10-minute signed link).
6. Pass the note ids when creating the claim/request so they are linked (web forms send `voiceNoteId`; via the API,
   create the note with `claimId`/`requestId` after the claim/request exists).
