# Covva app (`@im/web`, Vercel project covva-app)

Sign-in, the customer account, the partner workspace, the quote flow, shared quotes, consent links, the
embeddable widget, every `/api/*` route and the Vercel crons. The marketing pages live in `apps/site`
(covva-site). How the two link up, and the environment variables: `docs/APPS.md`.

```bash
pnpm --filter @im/web dev      # http://localhost:3102
pnpm --filter @im/web test     # unit tests
pnpm --filter @im/web test:db  # database rule tests (shared Supabase project)
pnpm --filter @im/web e2e      # browser tests (needs a build and the demo accounts)
```

Read `AGENTS.md` first: this Next.js version has breaking changes.
