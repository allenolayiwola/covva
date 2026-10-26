# Build brief (read this first)

You are one of several engineers building **Insurance Marketplace**, a Ghana
multi-insurer, multi-broker insurance marketplace. Read, in order:

1. `docs/PLAN.md` — product rules, design tokens, data model overview.
2. `docs/NEXT16_NOTES.md` — **Next.js 16.4 conventions. This is NOT the Next.js you know.** Follow it.
3. `docs/design/mockups/*.jpg` — the visual reference. Open the images and match them.
4. `supabase/migrations/*.sql` — the actual schema, triggers (business rules) and RLS.
5. `packages/core/src/*` — shared domain logic. Use it; don't re-implement it.
6. `packages/ui/src/index.tsx` — shared components. Use and extend them (add new
   generic components there if two apps need them; app-specific ones live in the app).

Source specs (for copy and intent): strategy doc + partnership proposal summarised in PLAN.md.

## Non-negotiable product rules (the database enforces most of them — don't fight it)

- The platform is the **technology provider**. It is never shown as insurer or broker,
  never gives advice in its own name, never holds premiums. Copy must say so.
- **One broker of record per request**, named to the customer *before* application
  (`broker_disclosures` row required; trigger blocks applications otherwise).
- **Only the insurer activates cover** (`policies.status = 'active'` requires insurer
  membership or service role + policy_number). *Payment confirmation alone never activates a policy.*
- **Only the insurer decides claims** (approved/rejected/paid). Reporting ≠ approval.
  Uploads ≠ insurer notification until `delivered_to_insurer_at` is set.
- **Premiums settle to insurers** (`payments.payee_org_id` must be an insurer org).
- **Quotes show their state**: `estimate` / `awaiting_underwriting` / `ready_to_accept`. Only
  `ready_to_accept` can be applied for, and only before `valid_until` (checkout revalidation).
- **Comparison integrity**: show the number of insurers/products compared, never claim
  whole-market coverage, no unexplained "best" label (use `LABELS` from `@im/core`), paid
  placements labelled and kept out of the ranking, time-stamp quotes.
- **Category availability** (`integrated` / `broker_assisted` / `planned`) is admin-controlled;
  never hard-code it. Unavailable categories are labelled, not hidden.
- Every customer-facing transaction screen shows the **mandatory disclosure**
  (`buildDisclosure()` from `@im/core` + `<DisclosureBlock>` from `@im/ui`).
- Demo partners are fictional (`organizations.settings.demo = true`). When the
  `demo_mode` feature flag is on, show `<DemoBadge />` near insurer names/prices.
- AI explains, summarises, extracts and drafts. **AI never makes suitability or claim
  decisions** and its output is always labelled as AI-assisted and reviewable by a human.

## Architecture

```
apps/web     Next.js 16 — marketing site, customer app, partner workspace (broker + insurer), /api/v1
apps/admin   Next.js 16 — platform administration portal (platform staff only)
apps/mobile  (owned by a separate agent — do not create or edit)
packages/core    domain logic + zod API contracts (shared with mobile)
packages/db      generated Supabase types: Row<"requests">, Enum<"request_status">…
packages/tokens  design tokens (TS + Tailwind theme.css)
packages/ui      shared React components
supabase/migrations  SQL (applied to project krmnyqaweawkpygjmdry)
```

### apps/web route map and ownership

| Path | Owner | Notes |
|---|---|---|
| `src/app/(marketing)/**`, `src/components/marketing/**` | Marketing | public, mostly static/cached |
| `src/app/(auth)/**` | Customer | sign-in/up, OTP, callback, onboarding & consent |
| `src/app/(customer)/account/**`, `src/components/customer/**` | Customer | signed-in customer app |
| `src/app/(partner)/partner/**`, `src/components/partner/**` | Partner | broker + insurer workspace |
| `src/app/api/**`, `src/server/**`, `packages/ai/**` | Backend | API v1, services, webhooks, cron, AI |
| `src/app/layout.tsx`, `src/app/globals.css`, `src/proxy.ts`, `src/lib/**` | Foundation (lead) | ask before changing; additive helpers OK |

Do **not** edit files owned by another stream. If you need something from another stream,
write to the agreed interface (below) and note it in your final report.

### Shared server helpers (already provided in `src/lib`)

- `@/lib/supabase/server` → `createClient()` (user, RLS), `createServiceClient()` (service role,
  server-only, for webhooks/cron/system writes), `createPublicClient()` (anon, cacheable reads).
- `@/lib/supabase/client` → browser client.
- `@/lib/auth` → `getUser()`, `requireUser(next?)`, `getMemberships()`, `requirePartner(kind?)`,
  `getProfile()`.
- `@/lib/catalog` → cached reads of categories / products / flags / settings.
- `@/server/requests` (Backend owns; foundation version provided) → `createRequest()`,
  `generateEstimates()`, `assignBroker()`.

### Conventions

- TypeScript strict. Use `Row<"table">` / `Enum<"x">` from `@im/db` for types.
- Mutations: Server Actions colocated as `actions.ts` with `"use server"`, validated with zod
  (schemas from `@im/core` where they exist). Return `{ ok: false, error }` objects for
  form errors; use `useActionState` on the client.
- Data reads in Server Components through the RLS client. Use the service client **only**
  when the operation is a system action that RLS deliberately blocks (payments, webhooks,
  notifications, cron) and document why in a comment.
- Map Postgres trigger errors (code `P0001`) to friendly messages — they are business-rule
  violations, show the message to the user.
- Styling: Tailwind v4 with tokens from `@im/tokens/theme.css` (`bg-brand`, `text-ink`,
  `text-muted`, `border-line`, `bg-mint`, `bg-mist`, `bg-amber-bg`, `text-amber`,
  `rounded-card`, `shadow-float`…). Inter font. Match the mockups: generous whitespace,
  1px `line` borders, 16px card radius, teal primary buttons, mint secondary buttons,
  amber pills for waiting states.
- Icons: `lucide-react`.
- Accessibility: semantic HTML, labels on every input, focus states, 4.5:1 contrast,
  keyboard navigable, works at 360px wide. Low-bandwidth: avoid heavy client JS; prefer
  server components; images optimised; forms resumable (drafts saved).
- Money: `formatGHS()` from `@im/core`. Dates: `formatDate()`.
- Copy: plain, warm, precise British English. Never promise instant cover, approval, or
  "best" insurance. Use "participating insurers".
- Don't add new dependencies without need; if you add one, use an exact recent version.
- Never put secrets in code. Read env from `process.env` (see `.env.example`).

### Verification before you finish

Run from the app dir: `pnpm typecheck` and `pnpm build` (build may need env — `.env.local`
exists with public Supabase values). Fix all type errors you introduced. If something can't
be verified (e.g. needs a secret), say so in your report.
