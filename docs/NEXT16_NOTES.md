# Next.js 16.4 / AI SDK 7 / Supabase SSR — engineering notes

Source of truth: the docs bundled in `apps/web/node_modules/next/dist/docs/` (Next 16.4.3), the typings of `ai@7.0.153`, `@ai-sdk/react@4.0.157`, `@ai-sdk/gateway@4.0.126` and `@supabase/ssr@0.12.7`. Anything not covered there is marked **(not in bundled docs)**. Read this before writing code; most model/StackOverflow knowledge is Next 14/15-era and wrong here.

Our config: `cacheComponents: true`, `partialPrefetching: true`, Turbopack (default), `src/` dir.

---

## 1. Request interception: `proxy.ts` (not `middleware.ts`)

- `middleware.ts` is **deprecated and renamed to `proxy.ts`**. The exported function is named `proxy` (or default export). Codemod: `npx @next/codemod@canary middleware-to-proxy .`
- Location: `apps/web/src/proxy.ts` (same level as `app/`). Only one per project; split logic into modules and import.
- **Runtime is Node.js and cannot be configured.** Exporting `runtime` from proxy throws. Edge is *not* supported in `proxy` (only legacy `middleware` keeps edge).
- Config keys renamed: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`.
- Without a `matcher`, proxy runs on **every** request incl. `_next/static`, `_next/image`, `public/`. Always use a negative matcher. Matchers must be static constants.
- `fetch` cache options (`cache`, `next.revalidate`, `next.tags`) have no effect in proxy. `revalidateTag`/`revalidatePath` cannot be called in proxy. `after()` and `event.waitUntil()` can.
- Docs' position: proxy is for **optimistic** checks only (read the cookie, redirect). Do not treat it as the authorization layer. Server Functions are POSTs to the page route, so a matcher change can silently drop coverage — **re-check auth inside every Server Action and Route Handler**.

```ts
// src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server'
export async function proxy(request: NextRequest) { /* ... */ return NextResponse.next() }
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

Typed shorthand: `import type { NextProxy } from 'next/server'; export const proxy: NextProxy = (request, event) => {...}`.
To pass data downstream use `NextResponse.next({ request: { headers } })` (forwards request headers). Do **not** use `NextResponse.next({ headers })` (sends to client, can break Server Actions).

---

## 2. Cache Components (`cacheComponents: true`) — the big one

Mental model: **everything is dynamic (request-time) by default; nothing is cached unless you add `'use cache'`.** Next prerenders a static shell (PPR is now the default, no `experimental.ppr`) and every component that can't finish at build time must be either **cached** (`'use cache'`) or **behind `<Suspense>`** (streams at request time).

### 2.1 What blocks prerendering
| Access | Category | Fix |
|---|---|---|
| `cookies()`, `headers()`, `params`, `searchParams` | runtime data | wrap reader in `<Suspense>` (or `'use cache: private'`) |
| `fetch(...)`, DB / Supabase queries, async `fs` | uncached data | `'use cache'` **or** `<Suspense>` |
| `connection()` | explicit request-time marker | `<Suspense>` |
| `Math.random()`, `Date.now()`, `new Date()`, `crypto.randomUUID()` | sync "unstable values" | `await connection()` first + `<Suspense>`, or `'use cache'`, or do it in a Client Component |
| sync imports, `fs.readFileSync`, pure computation | predictable | nothing; goes in shell |

`<Suspense>` alone does not make something dynamic; it only provides the fallback. `loading.tsx` = an implicit `<Suspense>` around `page` (it does **not** wrap the same segment's `layout.tsx`).

### 2.2 The errors you'll see (dev overlay / `next build`)
Exact text from `next/dist/server/app-render/blocking-route-messages.js`:

- `Route "/x": Next.js encountered uncached data during prerendering.` — "`fetch(...)` or `connection()` accessed outside of `<Suspense>` prevents the route from being prerendered…" → docs `blocking-prerender-dynamic`
- `Route "/x": Next.js encountered runtime data during prerendering or a navigation.` — "`cookies()`, `headers()`, `params`, or `searchParams` accessed outside of `<Suspense>`…" → `blocking-prerender-runtime`
- `…encountered URL data during prerendering or a navigation.` (`params`/`searchParams`) → `instant-shell-url-data`
- `…encountered the unstable value ${expr} while prerendering.` (random/time/crypto) → `blocking-prerender-random|current-time|crypto`
- `next-request-in-use-cache` — `cookies()/headers()` called (anywhere down the call stack) inside `'use cache'`. **Can pass `next build` and only fail at runtime** on dynamic routes.
- `empty-generate-static-params` — `generateStaticParams` returned `[]` (must return ≥1 param now).
- `Route segment config "dynamicParams" is not compatible with nextConfig.cacheComponents.`
- Using `dynamic`, `revalidate`, `fetchCache` exports → error.

Each message lists fixes: `[stream]` Suspense, `[cache]` `"use cache"`, `[block]` `export const instant = false`.

### 2.3 Route segment config under cacheComponents
- **Removed/erroring:** `export const dynamic`, `revalidate`, `fetchCache`, `dynamicParams`, `experimental_ppr`, and **`runtime` (even `'nodejs'`)** — remove all of them.
- Replacements: `force-dynamic` → just delete it (default). `force-static` / `revalidate = N` → `'use cache'` + `cacheLife(...)`. `revalidate = 0` → delete. `unstable_noStore()` → delete (use `connection()` if you need request time).
- Still allowed: `maxDuration`, `preferredRegion` (deprecated). New: `export const instant = false | true | { level: 'warning' }` (opt a segment out of/into instant-navigation validation; `false` = "allowed to block", does **not** silence sync-IO errors) and `export const ensureStatic = 'auto'|'shell'|'prefetch'|'navigation'|false` (16.4+, assert static output), `export const prefetch = 'partial'` (per-segment Partial Prefetching).
- Codemod to get a building app quickly: `npx @next/codemod@canary cache-components-instant-false ./src/app` (pass `./src/app`! wrong path reports `0 ok`).

### 2.4 `'use cache'`, `cacheLife`, `cacheTag`
```ts
import { cacheLife, cacheTag } from 'next/cache'   // no more unstable_ prefix

export async function getPlans(productId: string) {
  'use cache'
  cacheLife('hours')
  cacheTag('plans', `plans:${productId}`)
  return db.query(/* ... */)            // args + captured vars form the cache key
}
```
- Put at top of an async function, component, page/layout, or file (all exports cached). **Cannot** be put on a Route Handler's `GET` itself — use a helper.
- Inside `'use cache'`: **no `cookies()`/`headers()`/`searchParams`** (follows call stack). Read them outside and pass primitives as args. `draftMode().isEnabled` is allowed.
- Args must be serializable (no class instances, functions, URL); return values may include JSX. `children`/server actions may be passed through untouched.
- Cache keys and tags are stored **in plain text** — key on user/org IDs, never tokens/emails.
- Always pair with `cacheLife`. Presets (`stale / revalidate / expire`): `default` 5m/15m/never, `seconds` 30s/1s/1m, `minutes` 5m/1m/1h, `hours` 5m/1h/1d, `days` 5m/1d/1w, `weeks` 5m/1w/30d, `max` 5m/30d/1y. Custom profiles via `cacheLife: { name: {stale, revalidate, expire} }` in `next.config.ts`, or inline `cacheLife({ ... })`.
- Short lifetimes: `revalidate: 0` or `expire < 5 min` (i.e. `'seconds'`) → excluded from prerender ("dynamic hole", needs `<Suspense>`); `stale < 30s` → excluded from prefetch. Client router enforces min 30 s stale.
- Default store is **in-memory per instance** — on Vercel serverless entries mostly don't survive between requests (build-time prerender still works). `'use cache: remote'` = durable shared handler (platform-provided on Vercel). No cache survives a new deploy.
- `'use cache: private'`: may read `cookies()/headers()/searchParams` (not `connection()`); result cached **only in the browser**, never server-side. Good for "current user" helpers so authenticated pages can be prefetched.
- `React.cache` scopes are isolated per `'use cache'` boundary.

### 2.5 Recommended page patterns
```tsx
// Push dynamic access down; keep the page/layout itself non-async where possible
export default function Page({ params, searchParams }: PageProps<'/quotes/[id]'>) {
  return (
    <>
      <StaticHeader />                         {/* in shell */}
      <CachedCatalogue />                      {/* 'use cache' → in shell */}
      <Suspense fallback={<QuoteSkeleton />}>
        <Quote params={params} />              {/* await params / cookies / supabase inside */}
      </Suspense>
    </>
  )
}
async function Quote({ params }: Pick<PageProps<'/quotes/[id]'>, 'params'>) {
  const { id } = await params
  const supabase = await createClient()       // reads cookies() → must be inside Suspense
  // ...
}
```
- **Never `await cookies()`/session at the top of a layout** — it holds the whole segment (incl. `{children}`) behind the request. Root layout attributes driven by cookies (`data-theme`, `lang`) make the entire tree request-bound; docs recommend an inline `<head>` script instead.
- Client hooks: `useSearchParams()` **always** needs a `<Suspense>` boundary; `usePathname/useParams/useSelectedLayoutSegment(s)` need one when the route has unknown dynamic params (e.g. nav in a shared layout) — otherwise build fails.
- `generateStaticParams` must return at least one entry; unlisted params render at request time (ISR-style with App Shell). If you used `dynamicParams = false`, call `notFound()` instead.
- `generateMetadata` / `generateViewport` follow the same rules. If metadata needs runtime data while the page is otherwise static you get an error; either `'use cache'` it, or add a "dynamic marker" (`<Suspense><Connection/></Suspense>` where `Connection` does `await connection(); return null`).
- Auth pages (Supabase): session reads are request-time → put user-specific UI behind `<Suspense>`; cache user-derived data by passing `userId` into an **unexported** `'use cache'` function tagged e.g. `quotes:${userId}`; invalidate with `updateTag`.

### 2.6 Invalidation (`next/cache`)
| API | Where | Semantics |
|---|---|---|
| `updateTag(tag)` | **Server Actions only** (throws elsewhere) | expire now; next read waits for fresh data (read-your-writes). Re-renders current route in the action response. |
| `revalidateTag(tag, profile)` | Server Functions, Route Handlers | **2nd arg required now** (`'max'` recommended = SWR; `{ expire: 0 }` = hard expire). 1-arg form deprecated/TS error. Doesn't re-render in action response. Use in webhooks. |
| `revalidatePath(path, type?)` | Server Functions, Route Handlers | `type: 'page'|'layout'` required for patterns like `/quotes/[id]`. Use destination path for rewrites. |
| `refresh()` | **Server Actions only** | refetch current route RSC without invalidating caches. |

None of these can be called from proxy or Client Components. Calling any of them from a Server Action clears the whole client router cache.

---

## 3. `partialPrefetching: true`
- Requires `cacheComponents` (config validation throws otherwise). Leaving it unset logs a warning. Introduced 16.3; both flags become default in the next major.
- Default `<Link>` prefetch now fetches **one shared App Shell per route** (static + cached content + session-derived content from `cookies()/headers()`, auto-cached per session on the client). Content depending on `params`/`searchParams` resolves after navigation.
- `<Link prefetch={true}>` = per-link prefetch: also resolves URL data and cached content behind it. Costs one server invocation per link — use only where worth it (e.g. not every row of a long list). `prefetch={false}` unchanged.
- Author obligations: nothing mandatory. To make content prefetchable, cache it (`'use cache'` with `stale ≥ 30s`). Prefetching doesn't run in `next dev`; test against a production build.
- Cache Components also keeps previous routes mounted via React `<Activity mode="hidden">`: **component state, form inputs, `useActionState` results persist across back/forward**. Reset dialogs/forms explicitly (see `preserving-ui-state` guide).

---

## 4. Async request APIs & typing helpers
- **Sync access is fully removed in 16.** All are Promises: `cookies()`, `headers()`, `draftMode()` (from `next/headers`), `params` in `layout/page/route/default/opengraph-image/twitter-image/icon/apple-icon`, `searchParams` in `page`. Image metadata functions now get `params` **and `id`** as Promises; `sitemap({ id })` gets `id: Promise<string>`. `generateImageMetadata` still gets sync `params`.
- Client Components: unwrap with React `use()` or use `useParams()`.
- Global type helpers (no import; generated by `next dev`/`next build`/`npx next typegen`):
  - `PageProps<'/blog/[slug]'>` → `params`, `searchParams` (both Promises)
  - `LayoutProps<'/dashboard'>` → `children`, `params`, named parallel slots
  - `RouteContext<'/users/[id]'>` → Route Handler second arg (`ctx.params` Promise)
- `cookies().set/delete` only in Server Functions / Route Handlers (not during render; HTTP can't set cookies after streaming starts).
- `connection()` from `next/server` = "wait for a real request" (replacement for `unstable_noStore`, and the way to read runtime `process.env` values instead of build-time inlining).
- `next/root-params` replaces removed `unstable_rootParams`.

---

## 5. Server Functions / Server Actions
- `'use server'` at top of file (all exports become actions) or top of an async function. Invoked via `<form action={fn}>`, `formAction`, or event handlers/`startTransition`.
- `useActionState(action, initialState)` (from `react`) → `[state, formAction, pending]`; the action signature becomes `(prevState, formData)`. `useFormStatus()` from `react-dom` for a child submit button's `pending`.
- `redirect()` (from `next/navigation`) **throws** — call `updateTag`/`revalidatePath` before it; don't wrap it in try/catch that swallows it (`unstable_rethrow` exists for that).
- Single round-trip: if the action calls `updateTag`, `revalidatePath`, `refresh`, sets/deletes a cookie, or `redirect`s, the response carries the re-rendered route. `revalidateTag(tag,'max')` does not.
- Client dispatches actions **one at a time** (no parallelism via `Promise.all`).
- Security: each action is a public POST endpoint. Authenticate, authorize, validate (zod) in **every** action; return narrow shapes. CSRF origin check built in; configure `experimental.serverActions.allowedOrigins` / `bodySizeLimit` (default 1 MB) if needed. Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` for multi-instance self-hosting.
- `after(cb)` from `next/server`: run work after the response (logging, analytics, emails). Allowed in Server Components, Server Functions, Route Handlers, proxy. Not a request-time API (won't make a route dynamic); runs even on error/redirect; bounded by `maxDuration`.

---

## 6. Route Handlers (`route.ts`)
```ts
import type { NextRequest } from 'next/server'
export async function GET(req: NextRequest, ctx: RouteContext<'/api/quotes/[id]'>) {
  const { id } = await ctx.params
  const q = req.nextUrl.searchParams.get('q')
  return Response.json({ id, q })
}
```
- Methods: `GET POST PUT PATCH DELETE HEAD OPTIONS` (others → 405). `route.ts` can't coexist with `page.tsx` in the same segment.
- **With cacheComponents, `GET` follows the page model**: it is **prerendered at build** if it touches no uncached/runtime data. Prerendering stops on network/DB/async-fs access, reading `req.url`, `request.headers`, `request.cookies`, `request.body`, `cookies()`, `headers()`, `connection()`, or random/time. To cache data in a GET, call a `'use cache'` helper. The bail-out works by **throwing** — a broad `try/catch` will catch it (`experimental.hideLogsAfterAbort: true` hides noise). Other methods are never cached.
  - ⚠️ A GET with no request-dependent access (e.g. a cron/health endpoint that only writes to DB via a static client) could be frozen at build — make it read `request.headers` (e.g. auth header) or `await connection()`.
- Streaming: return `new Response(readableStream)`. The bundled docs' AI example (`StreamingTextResponse`, `toAIStream`) is **stale** — use §11.
- `runtime` export is not allowed under cacheComponents; `maxDuration` is (use for AI routes, e.g. `export const maxDuration = 60`).
- `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, `icon.tsx` are special Route Handlers, static by default.

---

## 7. Metadata & fonts
- `export const metadata: Metadata` or `export async function generateMetadata({ params, searchParams }, parent: ResolvingMetadata): Promise<Metadata>` (types from `next`). Server Components only; not both in one segment; shallow-merged root→leaf (nested `openGraph` is replaced, not merged). Use `metadataBase` for absolute OG URLs. `viewport` → separate `export const viewport` / `generateViewport`.
- `app/sitemap.ts` → `export default function sitemap(): MetadataRoute.Sitemap`; `app/robots.ts` → `MetadataRoute.Robots`. If they query the DB, put the query in a `'use cache'` helper (same GET rules).
- `opengraph-image.tsx`: `import { ImageResponse } from 'next/og'`; export `alt`, `size`, `contentType`; default export `async function Image({ params })` with `await params`.
- `global-error.tsx` can't export metadata (use `<title>`).
- Fonts (Tailwind v4):
```tsx
// src/app/layout.tsx
import { Inter } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return <html lang="en" className={inter.variable}><body>{children}</body></html>
}
```
```css
@import 'tailwindcss';
@theme inline { --font-sans: var(--font-inter); }
```
Self-hosted at build; no request to Google at runtime.

---

## 8. Errors, loading, not-found, routing conventions
- `error.tsx` must be `'use client'`. **Props changed:** `{ error: unknown, retry: () => void }` (`retry` stable in 16.3; re-fetches + re-renders). `reset()` still exists but is the non-refetch variant. Narrow `error` (`instanceof Error`) before reading `.message`/`.digest`. Server errors show a generic message + `digest` in prod.
- `global-error.tsx`: replaces root layout; must render its own `<html><body>`, import its own styles/fonts.
- `catchError(Fallback)` from `next/error` (stable 16.3): component-level error boundary; fallback signature `(props, { error, retry, reset }: ErrorInfo)`; must be a Client Component. Doesn't swallow `redirect()`/`notFound()`.
- `not-found.tsx` renders on `notFound()` (from `next/navigation`). 404 status only if thrown before streaming starts; otherwise 200 + `noindex`. Same for `forbidden()`→403 and `unauthorized()`→401. So **call these before any Suspense boundary streams** if you care about status codes.
- `global-not-found.tsx` requires `experimental.globalNotFound: true` — useful with multiple root layouts.
- `forbidden.tsx` / `unauthorized.tsx` + `forbidden()` / `unauthorized()` exist but are **experimental**: require `experimental.authInterrupts: true`.
- Route groups `(marketing)`, `(app)`: not in URL; multiple root layouts → full reload between them; groups must not resolve to the same path.
- Parallel routes `@slot`: **every slot now requires a `default.tsx`** (build fails otherwise) — return `null` or call `notFound()`. Typed as props in `LayoutProps`.
- Intercepting routes: `(.)`, `(..)`, `(..)(..)`, `(...)` — typically for modals together with a `@modal` slot.

---

## 9. `next.config.ts` notes
- `images.remotePatterns` (e.g. Supabase Storage). `images.domains` is deprecated.
```ts
images: { remotePatterns: [new URL('https://<project>.supabase.co/storage/v1/object/public/**')] }
// or { protocol: 'https', hostname: '<project>.supabase.co', pathname: '/storage/v1/object/public/**', search: '' }
```
  New image defaults: `qualities` = `[75]` only (other `quality` props are coerced; unsupported `q` → 400), `minimumCacheTTL` 4 h, `imageSizes` without 16, `maximumRedirects` 3, local IPs blocked (`dangerouslyAllowLocalIP`), local `src` with query strings need `images.localPatterns[].search`. `next/legacy/image` deprecated.
- `transpilePackages`: **Turbopack transpiles workspace packages automatically** (our `@im/*` export raw `.ts`) — listing them is not required (harmless). Needed for `node_modules` deps shipping raw TS/JSX. A package can't be in both `transpilePackages` and `serverExternalPackages`.
- `typedRoutes: true` is stable (top-level, not `experimental`). Typed `<Link href>`.
- `reactCompiler: true` is stable but off by default (needs `babel-plugin-react-compiler`, slower builds).
- `cacheLife` custom profiles, `cacheHandlers`, `cacheMaxMemorySize` live here.
- `serverActions` options are still under `experimental.serverActions`.
- Tailwind v4: the docs' setup is `postcss.config.mjs` with `'@tailwindcss/postcss'`. Our `turbopack.rules` + `@tailwindcss/turbopack` loader is **not in the bundled Next docs** — if CSS breaks, fall back to the documented PostCSS setup.

---

## 10. Instrumentation & cron
- `src/instrumentation.ts`: `export function register()` (once per server instance, may be async) and `export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {}` (`import { type Instrumentation } from 'next'`). Use `process.env.NEXT_RUNTIME` to branch. `instrumentation-client.ts` exists for browser-side init.
- **Vercel Cron is not in the bundled docs.** (Outside these docs: `vercel.json` `crons` → GET route handler; verify `Authorization: Bearer ${CRON_SECRET}`.) Reading `request.headers` for that check also keeps the GET from being prerendered (§6).

---

## 11. Other breaking changes vs 14/15
- Node ≥ 20.9, TS ≥ 5.1; browsers Chrome/Edge/Firefox 111+, Safari 16.4+.
- **Turbopack is default** for `dev` and `build` (no `--turbopack` flag). A custom `webpack` config makes `next build` fail unless `--webpack`. Config under top-level `turbopack`.
- `next dev` writes to `.next/dev`; dev & build can run concurrently; lockfile prevents duplicate instances. `process.argv.includes('dev')` in next.config no longer works — use `NODE_ENV`/`phase`.
- **`next lint` removed**; `next build` no longer lints; `eslint` key in next.config removed. Use ESLint flat config (`eslint.config.mjs` with `eslint-config-next/core-web-vitals` + `/typescript`), run `eslint .`.
- Removed: AMP, `serverRuntimeConfig`/`publicRuntimeConfig` (+ `getConfig`) → env vars (`NEXT_PUBLIC_*` for client; `await connection()` before reading runtime-only env), `experimental.dynamicIO`/`useCache`/`ppr`, `experimental_ppr`, `unstable_rootParams`, `devIndicators.appIsrStatus/buildActivity/buildActivityPosition`, build output `size`/`First Load JS` columns.
- `cacheLife`/`cacheTag` no `unstable_` prefix. `revalidateTag` needs 2 args. `updateTag`/`refresh` new.
- `scroll-behavior: smooth` is no longer overridden on navigation; add `data-scroll-behavior="smooth"` on `<html>` for the old behavior.
- Edge runtime (`runtime = 'edge'`) deprecated; disallowed under cacheComponents.
- Codemods: `npx @next/codemod@canary upgrade latest`, `middleware-to-proxy`, `next-lint-to-eslint-cli`, `cache-components-instant-false`.

---

## 12. Supabase SSR (`@supabase/ssr@0.12.7`)
- Use only `getAll` / `setAll` cookie methods (`get/set/remove` deprecated). Signature: `setAll(cookies: { name, value, options }[], headers: Record<string,string>)` — **new 2nd arg** carries `Cache-Control: private, no-cache, no-store…`, `Expires: 0`, `Pragma: no-cache`; apply them to the response so CDNs never cache a Set-Cookie. Headers are delivered only on the first write → **create a new server client per request**, never share.
- The client lazily loads the session; call `await supabase.auth.getClaims()` **early** (before generating a response) so refreshes are written. Use `getClaims()` (verifies JWT) or `getUser()` for identity — don't trust `getSession().user` server-side.
- `createBrowserClient(url, key, options?)` (singleton by default, `isSingleton`); falls back to `document.cookie`.

**Proxy (session refresh + optimistic protection):**
```ts
// src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value)) // visible to Server Components
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v))
      },
    },
  })
  const { data } = await supabase.auth.getClaims()   // triggers refresh; do not run code between create & this
  if (!data?.claims && request.nextUrl.pathname.startsWith('/account')) {
    const url = request.nextUrl.clone(); url.pathname = '/login'
    return NextResponse.redirect(url)  // (copy response.cookies onto redirects if you set any)
  }
  return response
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] }
```
(The request-cookie re-set + `NextResponse.next({ request })` re-creation is the standard Supabase pattern — **not in the bundled README**, which only shows the response side.)

**Server Components / Actions / Route Handlers:** see `src/lib/supabase/server.ts` — `await cookies()`, `getAll: () => cookieStore.getAll()`, `setAll` in `try/catch` (Server Components can't set cookies; proxy handles refresh). Rules with cacheComponents:
- Creating this client calls `cookies()` → **runtime data → must be inside `<Suspense>`** and **never inside `'use cache'`**.
- For public catalogue reads inside `'use cache'`, use the cookie-less `createPublicClient()` (plain `@supabase/supabase-js`).
- Re-verify the user (`getClaims()`) inside every Server Action / Route Handler; RLS is the real boundary.

---

## 13. Vercel AI SDK 7 (`ai@7.0.153`, `@ai-sdk/react@4.0.157`)
**Models / Gateway.** The AI Gateway is the default global provider: pass a plain `'creator/model'` string (`model: 'anthropic/claude-sonnet-5.5'`). Equivalent: `import { gateway } from 'ai'` → `gateway('openai/gpt-6-astra')`, or `createGateway({ apiKey, teamIdOrSlug })` from `ai`. Auth: env **`AI_GATEWAY_API_KEY`**; on Vercel deployments OIDC works without a key (locally `vercel env pull`, tokens expire after 12 h; a present API key always wins over OIDC). Gateway options go in `providerOptions: { gateway: { order, only, models /* fallbacks */, user, tags, sort } }` (`GatewayProviderOptions` type lives in `@ai-sdk/gateway`, not a direct dep — add it if you want `satisfies`). Model IDs above are the docs' examples — confirm availability on the gateway.

**Chat route (v7 shape):**
```ts
// src/app/api/chat/route.ts
import { streamText, convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream, isStepCount, tool, type UIMessage } from 'ai'
import { z } from 'zod'
export const maxDuration = 60

export async function POST(req: Request) {
  // authenticate here (Supabase getClaims) — route handlers are public endpoints
  const { messages }: { messages: UIMessage[] } = await req.json()
  const result = streamText({
    model: 'anthropic/claude-sonnet-5.5',
    instructions: 'You are an insurance assistant…',   // `system` is deprecated alias
    messages: await convertToModelMessages(messages), // async in v7
    stopWhen: isStepCount(5),                          // default is isStepCount(1); `stepCountIs` = alias
    tools: {
      getQuote: tool({
        description: 'Get a quote',
        inputSchema: z.object({ productId: z.string() }),
        execute: async ({ productId }, { toolCallId, abortSignal }) => ({ productId, premium: 12.5 }),
      }),
    },
    onEnd: ({ usage, finishReason }) => { /* persist usage */ }, // onFinish = deprecated alias
    onError: ({ error }) => console.error(error),
  })
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      messageMetadata: ({ part }) => (part.type === 'finish' ? { totalTokens: part.totalUsage.totalTokens } : undefined),
      onEnd: ({ messages }) => { /* save chat */ },
    }),
  })
}
```
`result.toUIMessageStreamResponse()` still exists but is **deprecated** in favor of the standalone helpers above. Callback renames: `onStepFinish`→`onStepEnd`, `onFinish`→`onEnd`, `experimental_onStart`→`onStart`, `experimental_onToolCallStart/Finish`→`onToolExecutionStart/End`.

**Structured output:** `generateObject`/`streamObject` are **deprecated** → use `generateText`/`streamText` with `output`:
```ts
import { generateText, Output } from 'ai'
const { output, usage } = await generateText({ model: 'openai/gpt-6-astra', output: Output.object({ schema: z.object({ risk: z.enum(['low','high']) }) }), prompt })
```
Also `Output.text()`, `Output.array({ element })`, `Output.choice({ options })`, `Output.json()`. Streaming: `streamText({ output })` → `partialOutputStream`. Output generation counts as a step (account for it in `stopWhen` when mixing with tools). Errors: `NoObjectGeneratedError`, `NoOutputGeneratedError`.

**Tools:** `tool({ description, inputSchema, execute, outputSchema?, needsApproval?, strict?, toModelOutput? })`; `execute(input, { toolCallId, messages, abortSignal, context })`. UI parts are typed `tool-${toolName}`. `dynamicTool()` for untyped tools.

**Usage accounting (`LanguageModelUsage`):** `inputTokens`, `inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}`, `outputTokens`, `outputTokenDetails.{textTokens, reasoningTokens}`, `totalTokens`, `raw` — all `number | undefined`. On `generateText` result / `onEnd` event: `usage` = **aggregated across all steps** (`totalUsage` is now a deprecated alias); per-step usage via `steps[i].usage`. On `streamText`: `await result.usage` (a Promise, consumes the stream). In the UI stream `finish` part: `part.totalUsage`.

**Client (`@ai-sdk/react` v4):**
```tsx
'use client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
const { messages, sendMessage, status, stop, regenerate, error, setMessages, addToolOutput } =
  useChat<MyUIMessage>({ transport: new DefaultChatTransport({ api: '/api/chat', body: { quoteId } }) })
// sendMessage({ text }) ; status: 'submitted' | 'streaming' | 'ready' | 'error'
// render message.parts: part.type === 'text' → part.text ; 'tool-getQuote' → part.state/input/output ; 'reasoning'
```
No `input`/`handleSubmit`/`append` — manage input with `useState`. Transport is how you set `api`, `headers`, `body`, `credentials`, `prepareSendMessagesRequest`. Typed metadata: `UIMessage<Metadata>` + `messageMetadataSchema`. `useObject` exists for `Output`-style object streams.
